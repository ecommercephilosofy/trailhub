import { describe, expect, it } from 'vitest';
import {
  buildCrmEvent,
  buildEventContent,
  contentHash,
  crmToContent,
  diffFields,
  linkAfterPull,
  linkAfterPush,
  reconcile,
  remoteToContent,
  visitDeepLink,
  type CalendarEventLink,
  type EventContentInput,
} from './sync';
import type { CrmEvent, RemoteEvent } from './types';

const APP_URL = 'https://crm.vitalpe.cat';
const WORKSPACE = 'ws-1';
const CLIENT = 'cli-42';
const VISIT = 'vis-7';

const CONTENT_INPUT: EventContentInput = {
  companyName: 'Caves Solé Germans',
  clientId: CLIENT,
  visitId: VISIT,
  appUrl: APP_URL,
  startsAt: '2026-07-28T09:00:00.000Z',
  endsAt: '2026-07-28T10:00:00.000Z',
  timeZone: 'Europe/Madrid',
  visitStatus: 'CONFIRMADA',
  address: { formatted: 'Camí del Celler 12, 08770 Sant Sadurní d’Anoia', verified: true },
  primaryContact: { name: 'Marta Solé', role: 'Direcció de compres', phone: '+34 938 000 111' },
  objective: 'Presentar la gamma de cava gran reserva',
  product: 'Cava Gran Reserva',
  operationalInfo: 'Portar dues ampolles de mostra i el full de preus 2026.',
};

function crmEvent(overrides: Partial<CrmEvent> = {}): CrmEvent {
  return {
    ...buildCrmEvent(
      { workspaceId: WORKSPACE, clientId: CLIENT, visitId: VISIT, updatedAt: '2026-07-23T09:00:00.000Z' },
      CONTENT_INPUT,
    ),
    ...overrides,
  };
}

function remoteFrom(event: CrmEvent, overrides: Partial<RemoteEvent> = {}): RemoteEvent {
  return {
    id: 'gev-1',
    calendarId: 'primary',
    etag: 'W/"1"',
    updated: '2026-07-23T09:00:00.000Z',
    status: event.status === 'CANCELLED' ? 'cancelled' : 'confirmed',
    summary: event.title,
    ...(event.location === undefined ? {} : { location: event.location }),
    description: event.description,
    start: { dateTime: event.startsAt, timeZone: event.timeZone },
    end: { dateTime: event.endsAt, timeZone: event.timeZone },
    identity: { crmWorkspaceId: WORKSPACE, crmClientId: CLIENT, crmVisitId: VISIT },
    ...overrides,
  };
}

function linkFor(event: CrmEvent, remote: RemoteEvent, overrides: Partial<CalendarEventLink> = {}): CalendarEventLink {
  return {
    visitId: event.visitId,
    calendarId: remote.calendarId,
    googleEventId: remote.id,
    etag: remote.etag,
    googleUpdatedAt: remote.updated,
    contentHash: contentHash(crmToContent(event)),
    lastChangeOrigin: 'CRM',
    lastSyncedAt: '2026-07-23T09:00:00.000Z',
    status: 'SINCRONITZAT',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

describe('buildEventContent — section 22.5', () => {
  const content = buildEventContent(CONTENT_INPUT);

  it('titles the event VISITA — <EMPRESA>', () => {
    expect(content.title).toBe('VISITA — CAVES SOLÉ GERMANS');
  });

  it('uses the verified visit address as the location', () => {
    expect(content.location).toBe('Camí del Celler 12, 08770 Sant Sadurní d’Anoia');
  });

  it('omits the location when the address is not verified', () => {
    const unverified = buildEventContent({
      ...CONTENT_INPUT,
      address: { formatted: 'Adreça sense verificar 1', verified: false },
    });
    expect(unverified.location).toBeUndefined();
    expect(JSON.stringify(unverified)).not.toContain('Adreça sense verificar');
  });

  it('carries contact, phone, objective, product and brief operational info', () => {
    expect(content.description).toContain('Marta Solé');
    expect(content.description).toContain('Direcció de compres');
    expect(content.description).toContain('+34 938 000 111');
    expect(content.description).toContain('Presentar la gamma de cava gran reserva');
    expect(content.description).toContain('Cava Gran Reserva');
    expect(content.description).toContain('Portar dues ampolles de mostra');
  });

  it('carries the deep link to the visit', () => {
    expect(content.description).toContain(`${APP_URL}/clients/${CLIENT}/visits/${VISIT}`);
    expect(visitDeepLink(`${APP_URL}/`, CLIENT, VISIT)).toBe(
      `${APP_URL}/clients/${CLIENT}/visits/${VISIT}`,
    );
  });

  it('NEVER carries transcripts, commercial history, secrets or extra personal data', () => {
    // Everything below is deliberately passed in and must be ignored: the
    // builder reads a fixed whitelist of fields, not whatever it is handed.
    const leaky = {
      ...CONTENT_INPUT,
      transcript:
        "Nota de veu: he trucat a la Marta, m'ha dit que el seu marit està malalt i que el 2024 van tenir problemes de tresoreria.",
      commercialHistory: [
        { year: 2024, amount: 18000, note: 'Impagament de 3.000 € regularitzat al març' },
      ],
      accessToken: 'ya29.a0ARrdaM-super-secret-token',
      apiKey: 'sk-ant-not-for-your-calendar',
      contactPersonalEmail: 'marta.sole.particular@gmail.com',
      contactNationalId: '12345678Z',
      internalMargin: '32%',
    } as EventContentInput;

    const built = buildEventContent(leaky);
    const serialised = JSON.stringify(built);

    for (const forbidden of [
      'Nota de veu',
      'el seu marit',
      'problemes de tresoreria',
      'Impagament',
      'ya29.a0ARrdaM',
      'sk-ant-',
      'marta.sole.particular@gmail.com',
      '12345678Z',
      '32%',
    ]) {
      expect(serialised, `«${forbidden}» must never reach a calendar event`).not.toContain(forbidden);
    }
  });

  it('truncates a long operational note instead of dumping it', () => {
    const long = buildEventContent({ ...CONTENT_INPUT, operationalInfo: 'x'.repeat(1000) });
    expect(long.description.length).toBeLessThan(900);
    expect(long.description).toContain('…');
  });

  it('maps visit status onto calendar status', () => {
    expect(buildEventContent({ ...CONTENT_INPUT, visitStatus: 'PLANIFICADA' }).status).toBe('TENTATIVE');
    expect(buildEventContent({ ...CONTENT_INPUT, visitStatus: 'CONFIRMADA' }).status).toBe('CONFIRMED');
    expect(buildEventContent({ ...CONTENT_INPUT, visitStatus: 'CANCEL·LADA' }).status).toBe('CANCELLED');
  });
});

describe('contentHash', () => {
  it('is stable across calls and independent of key order', () => {
    const a = buildEventContent(CONTENT_INPUT);
    const b = buildEventContent(CONTENT_INPUT);
    expect(contentHash(a)).toBe(contentHash(b));
  });

  it('ignores timezone representation of the same instant', () => {
    const utc = buildEventContent(CONTENT_INPUT);
    const offset = buildEventContent({
      ...CONTENT_INPUT,
      startsAt: '2026-07-28T11:00:00+02:00',
      endsAt: '2026-07-28T12:00:00+02:00',
    });
    expect(contentHash(utc)).toBe(contentHash(offset));
  });

  it('changes when a synced field changes', () => {
    const base = buildEventContent(CONTENT_INPUT);
    expect(contentHash(buildEventContent({ ...CONTENT_INPUT, objective: 'Un altre objectiu' }))).not.toBe(
      contentHash(base),
    );
  });

  it('reports which fields differ', () => {
    const a = buildEventContent(CONTENT_INPUT);
    const b = buildEventContent({ ...CONTENT_INPUT, startsAt: '2026-07-29T09:00:00.000Z' });
    expect(diffFields(a, b)).toEqual(['startsAt']);
  });
});

describe('reconcile', () => {
  it('creates the remote event on first sync', () => {
    const decision = reconcile({ link: null, crm: crmEvent(), remote: null });
    expect(decision.type).toBe('CREATE_REMOTE');
    expect(decision.audit.resolution).toBe('FIRST_SYNC');
  });

  it('does nothing when nothing changed', () => {
    const crm = crmEvent();
    const remote = remoteFrom(crm);
    const decision = reconcile({ link: linkFor(crm, remote), crm, remote });
    expect(decision.type).toBe('NOOP');
  });

  it('pushes when only the CRM changed, sending the stored ETag', () => {
    const crm = crmEvent();
    const remote = remoteFrom(crm);
    const link = linkFor(crm, remote);
    const edited = crmEvent({ description: 'Objectiu nou', updatedAt: '2026-07-23T10:00:00.000Z' });

    const decision = reconcile({ link, crm: edited, remote });
    expect(decision.type).toBe('UPDATE_REMOTE');
    if (decision.type !== 'UPDATE_REMOTE') throw new Error('unreachable');
    expect(decision.ifMatch).toBe('W/"1"');
    expect(decision.audit.resolution).toBe('ONLY_CRM_CHANGED');
    expect(decision.audit.fields).toContain('description');
  });

  it('pulls only when the marker moved AND the content actually differs', () => {
    const crm = crmEvent();
    const remote = remoteFrom(crm);
    const link = linkFor(crm, remote);

    // Marker moved but the payload is identical: a touch, not a change.
    const touched = remoteFrom(crm, { etag: 'W/"2"', updated: '2026-07-23T09:30:00.000Z' });
    expect(reconcile({ link, crm, remote: touched }).type).toBe('NOOP');

    // Marker moved and the payload differs: a real change.
    const changed = remoteFrom(crm, {
      etag: 'W/"3"',
      updated: '2026-07-23T09:40:00.000Z',
      location: 'Nou magatzem, Vilafranca',
    });
    const decision = reconcile({ link, crm, remote: changed });
    expect(decision.type).toBe('APPLY_TO_CRM');
    expect(decision.audit.resolution).toBe('ONLY_GOOGLE_CHANGED');
  });

  it('never echoes a pulled change back to Google', () => {
    const crm = crmEvent();
    const remote = remoteFrom(crm);
    let link = linkFor(crm, remote);

    const changed = remoteFrom(crm, {
      etag: 'W/"3"',
      updated: '2026-07-23T09:40:00.000Z',
      location: 'Nou magatzem, Vilafranca',
    });
    const pull = reconcile({ link, crm, remote: changed });
    expect(pull.type).toBe('APPLY_TO_CRM');
    if (pull.type !== 'APPLY_TO_CRM') throw new Error('unreachable');

    // Apply it to the CRM and record the new bookkeeping.
    const applied = crmEvent({ ...pull.content, updatedAt: '2026-07-23T09:41:00.000Z' });
    link = linkAfterPull(link, changed, pull.content, new Date('2026-07-23T09:41:00.000Z'));

    const next = reconcile({ link, crm: applied, remote: changed });
    expect(next.type).toBe('NOOP');
    expect(next.audit.resolution).toBe('ALREADY_CONVERGED');
  });

  it('cancels the visit — never deletes it — when the event disappears from Google', () => {
    const crm = crmEvent();
    const remote = remoteFrom(crm);
    const link = linkFor(crm, remote);
    const cancelled = remoteFrom(crm, {
      status: 'cancelled',
      etag: 'W/"9"',
      updated: '2026-07-23T11:00:00.000Z',
    });

    const decision = reconcile({ link, crm, remote: cancelled });
    expect(decision.type).toBe('CANCEL_VISIT_IN_CRM');
    expect(decision.audit.resolution).toBe('REMOTE_CANCELLED');
    // Nothing in the decision space can delete a visit.
    expect(['NOOP', 'CREATE_REMOTE', 'UPDATE_REMOTE', 'APPLY_TO_CRM', 'CANCEL_VISIT_IN_CRM', 'REMOTE_GONE', 'CONFLICT']).toContain(
      decision.type,
    );

    // Re-running is idempotent.
    const already = reconcile({ link, crm: crmEvent({ status: 'CANCELLED' }), remote: cancelled });
    expect(already.type).toBe('NOOP');
  });

  it('reports a vanished remote event instead of crashing', () => {
    const crm = crmEvent();
    const remote = remoteFrom(crm);
    const decision = reconcile({ link: linkFor(crm, remote), crm, remote: null });
    expect(decision.type).toBe('REMOTE_GONE');
  });

  it('resolves clearly ordered simultaneous edits by last-valid-write-wins', () => {
    const base = crmEvent();
    const remote0 = remoteFrom(base);
    const link = linkFor(base, remote0);

    const crmLater = crmEvent({ description: 'Editat al CRM', updatedAt: '2026-07-23T12:00:00.000Z' });
    const remoteEarlier = remoteFrom(base, {
      etag: 'W/"5"',
      updated: '2026-07-23T11:00:00.000Z',
      summary: 'Editat a Google',
    });
    const crmWins = reconcile({ link, crm: crmLater, remote: remoteEarlier });
    expect(crmWins.type).toBe('UPDATE_REMOTE');
    expect(crmWins.audit.resolution).toBe('CRM_WINS');

    const crmEarlier = crmEvent({ description: 'Editat al CRM', updatedAt: '2026-07-23T11:00:00.000Z' });
    const remoteLater = remoteFrom(base, {
      etag: 'W/"6"',
      updated: '2026-07-23T12:00:00.000Z',
      summary: 'Editat a Google',
    });
    const googleWins = reconcile({ link, crm: crmEarlier, remote: remoteLater });
    expect(googleWins.type).toBe('APPLY_TO_CRM');
    expect(googleWins.audit.resolution).toBe('GOOGLE_WINS');
  });

  it('raises a ConflictReport for simultaneous divergent edits', () => {
    const base = crmEvent();
    const remote0 = remoteFrom(base);
    const link = linkFor(base, remote0);

    const crm = crmEvent({ description: 'Editat al CRM', updatedAt: '2026-07-23T12:00:00.500Z' });
    const remote = remoteFrom(base, {
      etag: 'W/"7"',
      updated: '2026-07-23T12:00:00.000Z',
      summary: 'Editat a Google',
      description: 'Descripció diferent',
    });

    const decision = reconcile({ link, crm, remote, now: new Date('2026-07-23T12:00:05.000Z') });
    expect(decision.type).toBe('CONFLICT');
    if (decision.type !== 'CONFLICT') throw new Error('unreachable');
    expect(decision.report.visitId).toBe(VISIT);
    expect(decision.report.fields.sort()).toEqual(['description', 'title']);
    expect(decision.report.message).toContain('alhora');
    expect(decision.report.detectedAt).toBe('2026-07-23T12:00:05.000Z');
  });

  it('adopts an already existing event carrying the visit identity', () => {
    const crm = crmEvent();
    const identical = remoteFrom(crm);
    expect(reconcile({ link: null, crm, remote: identical }).type).toBe('NOOP');

    const different = remoteFrom(crm, { summary: 'Un altre títol' });
    const decision = reconcile({ link: null, crm, remote: different });
    expect(decision.type).toBe('UPDATE_REMOTE');
    expect(decision.audit.resolution).toBe('ADOPTED');
  });
});

describe('link bookkeeping', () => {
  it('records CRM origin and the pushed hash', () => {
    const crm = crmEvent();
    const remote = remoteFrom(crm, { etag: 'W/"11"', updated: '2026-07-23T13:00:00.000Z' });
    const link = linkAfterPush(
      {
        visitId: crm.visitId,
        calendarId: remote.calendarId,
        googleEventId: remote.id,
        lastChangeOrigin: 'CRM',
        status: 'PENDENT',
      },
      remote,
      crmToContent(crm),
      new Date('2026-07-23T13:00:01.000Z'),
    );
    expect(link.lastChangeOrigin).toBe('CRM');
    expect(link.status).toBe('SINCRONITZAT');
    expect(link.etag).toBe('W/"11"');
    expect(link.contentHash).toBe(contentHash(crmToContent(crm)));
  });

  it('records Google origin and the pulled hash', () => {
    const crm = crmEvent();
    const remote = remoteFrom(crm, { etag: 'W/"12"', summary: 'VISITA — ALTRA' });
    const applied = remoteToContent(remote, crm.timeZone);
    const link = linkAfterPull(
      linkFor(crm, remote),
      remote,
      applied,
      new Date('2026-07-23T14:00:00.000Z'),
    );
    expect(link.lastChangeOrigin).toBe('GOOGLE CALENDAR');
    expect(link.contentHash).toBe(contentHash(applied));
  });
});
