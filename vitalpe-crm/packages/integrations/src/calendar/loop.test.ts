/**
 * The end-to-end bidirectional loop, run against the local provider.
 *
 * create → push update → receive a webhook → incremental sync → update the CRM
 * → **no echo back to the provider**. The last step is the one that matters:
 * the assertion counts outbound mutating calls and requires zero.
 */
import { describe, expect, it } from 'vitest';
import { LocalCalendarProvider } from './local';
import {
  buildCrmEvent,
  contentHash,
  crmToContent,
  linkAfterPull,
  linkAfterPush,
  reconcile,
  type CalendarEventLink,
  type EventContentInput,
} from './sync';
import { SyncTokenInvalidError, type CalendarProvider, type CrmEvent } from './types';
import { NotificationDeduplicator, verifyChannel } from './webhook';

class TestClock {
  private ms = Date.parse('2026-07-23T09:00:00.000Z');
  now = (): Date => new Date(this.ms);
  sleep = async (): Promise<void> => {};
  random = (): number => 0.5;
  advance(ms: number): void {
    this.ms += ms;
  }
}

/** Counts every mutating call so "no echo" is a measured fact. */
function countingProvider(inner: LocalCalendarProvider): {
  provider: CalendarProvider;
  writes: () => number;
} {
  let writes = 0;
  const provider: CalendarProvider = {
    name: inner.name,
    createEvent: (...args) => {
      writes += 1;
      return inner.createEvent(...args);
    },
    updateEvent: (...args) => {
      writes += 1;
      return inner.updateEvent(...args);
    },
    deleteEvent: (...args) => {
      writes += 1;
      return inner.deleteEvent(...args);
    },
    getEvent: (...args) => inner.getEvent(...args),
    listChanged: (...args) => inner.listChanged(...args),
    watch: (...args) => inner.watch(...args),
    stopWatch: (...args) => inner.stopWatch(...args),
    createCalendar: (...args) => inner.createCalendar(...args),
    listCalendars: () => inner.listCalendars(),
  };
  return { provider, writes: () => writes };
}

const BASE_INPUT: EventContentInput = {
  companyName: 'Caves Solé Germans',
  clientId: 'cli-42',
  visitId: 'vis-7',
  appUrl: 'https://crm.vitalpe.cat',
  startsAt: '2026-07-28T09:00:00.000Z',
  endsAt: '2026-07-28T10:00:00.000Z',
  timeZone: 'Europe/Madrid',
  visitStatus: 'CONFIRMADA',
  address: { formatted: 'Camí del Celler 12', verified: true },
  primaryContact: { name: 'Marta Solé', phone: '+34 938 000 111' },
  objective: 'Presentar la gamma de cava gran reserva',
};

function crmEvent(input: Partial<EventContentInput>, updatedAt: string): CrmEvent {
  return buildCrmEvent(
    { workspaceId: 'ws-1', clientId: 'cli-42', visitId: 'vis-7', updatedAt },
    { ...BASE_INPUT, ...input },
  );
}

describe('bidirectional loop, end to end', () => {
  it('creates, pushes, pulls and never echoes back', async () => {
    const clock = new TestClock();
    const local = new LocalCalendarProvider({ clock });
    const { provider, writes } = countingProvider(local);
    const dedupe = new NotificationDeduplicator();

    // --- open a watch channel -------------------------------------------
    const channel = await provider.watch('primary', 'https://crm.vitalpe.cat/api/google/webhook');
    local.drainNotifications(); // discard the initial `sync` notification

    // --- 1. first sync: create ------------------------------------------
    let crm = crmEvent({}, '2026-07-23T09:00:00.000Z');
    const create = reconcile({ link: null, crm, remote: null });
    expect(create.type).toBe('CREATE_REMOTE');

    const created = await provider.createEvent('primary', crm);
    let link: CalendarEventLink = linkAfterPush(
      {
        visitId: crm.visitId,
        calendarId: 'primary',
        googleEventId: created.id,
        lastChangeOrigin: 'CRM',
        status: 'PENDENT',
      },
      created,
      crmToContent(crm),
      clock.now(),
    );
    let syncToken = (await provider.listChanged({ calendarId: 'primary' })).nextSyncToken as string;
    expect(writes()).toBe(1);

    // --- 2. the commercial edits the visit in the CRM: push -------------
    clock.advance(60_000);
    crm = crmEvent({ objective: 'Tancar la comanda de gran reserva' }, clock.now().toISOString());
    const push = reconcile({ link, crm, remote: await provider.getEvent('primary', created.id) });
    expect(push.type).toBe('UPDATE_REMOTE');
    if (push.type !== 'UPDATE_REMOTE') throw new Error('unreachable');
    expect(push.ifMatch).toBe(link.etag);

    const pushed = await provider.updateEvent('primary', created.id, crm, { etag: push.ifMatch });
    link = linkAfterPush(link, pushed, crmToContent(crm), clock.now());
    expect(writes()).toBe(2);

    // Our own push produced a notification; it must not cause a pull.
    const ownEcho = local.drainNotifications();
    expect(ownEcho.length).toBeGreaterThan(0);
    const afterOwnPush = await provider.listChanged({ calendarId: 'primary', syncToken });
    syncToken = afterOwnPush.nextSyncToken as string;
    const noEchoPull = reconcile({ link, crm, remote: afterOwnPush.events[0] ?? null });
    expect(noEchoPull.type).toBe('NOOP');

    // --- 3. somebody moves the meeting in Google -----------------------
    clock.advance(120_000);
    local.editDirectly('primary', created.id, {
      startsAt: '2026-07-28T11:00:00.000Z',
      endsAt: '2026-07-28T12:00:00.000Z',
    });

    // --- 4. the webhook arrives -----------------------------------------
    const notifications = local.drainNotifications();
    expect(notifications).toHaveLength(1);
    const verification = verifyChannel(notifications[0] as Record<string, string>, {
      channelId: channel.channelId,
      verificationToken: channel.verificationToken,
    });
    expect(verification.ok).toBe(true);
    if (!verification.ok) throw new Error('unreachable');
    expect(dedupe.accept(verification.notification)).toBe(true);

    // --- 5. incremental sync --------------------------------------------
    const changes = await provider.listChanged({ calendarId: 'primary', syncToken });
    syncToken = changes.nextSyncToken as string;
    expect(changes.events).toHaveLength(1);
    const remote = changes.events[0]!;

    // --- 6. apply to the CRM --------------------------------------------
    const pull = reconcile({ link, crm, remote });
    expect(pull.type).toBe('APPLY_TO_CRM');
    if (pull.type !== 'APPLY_TO_CRM') throw new Error('unreachable');
    expect(pull.content.startsAt).toBe('2026-07-28T11:00:00.000Z');

    crm = { ...crm, ...pull.content, updatedAt: clock.now().toISOString() };
    link = linkAfterPull(link, remote, pull.content, clock.now());

    // --- 7. NO ECHO ------------------------------------------------------
    const writesBefore = writes();
    const afterPull = reconcile({ link, crm, remote });
    expect(afterPull.type).toBe('NOOP');
    expect(afterPull.audit.resolution).toBe('ALREADY_CONVERGED');

    // Even a fresh incremental round finds nothing to send back.
    const quiet = await provider.listChanged({ calendarId: 'primary', syncToken });
    expect(quiet.events).toHaveLength(0);
    for (const event of quiet.events) {
      const decision = reconcile({ link, crm, remote: event });
      if (decision.type === 'UPDATE_REMOTE') {
        await provider.updateEvent('primary', event.id, crm);
      }
    }
    expect(writes()).toBe(writesBefore); // ← zero outbound calls
    expect(local.drainNotifications()).toHaveLength(0);
  });

  it('applies a replayed webhook exactly once', async () => {
    const clock = new TestClock();
    const local = new LocalCalendarProvider({ clock });
    const dedupe = new NotificationDeduplicator();
    const channel = await local.watch('primary', 'https://crm.vitalpe.cat/api/google/webhook');
    const created = await local.createEvent('primary', crmEvent({}, '2026-07-23T09:00:00.000Z'));
    local.editDirectly('primary', created.id, { location: 'Nova adreça' });

    const notifications = local.drainNotifications();
    const last = notifications.at(-1) as Record<string, string>;

    const first = verifyChannel(last, channel);
    expect(first.ok && dedupe.accept(first.notification)).toBe(true);

    // Google retries the very same delivery.
    const replay = verifyChannel(last, channel);
    expect(replay.ok).toBe(true);
    if (!replay.ok) throw new Error('unreachable');
    expect(dedupe.accept(replay.notification)).toBe(false);
  });

  it('rejects a forged webhook without touching the calendar', async () => {
    const clock = new TestClock();
    const local = new LocalCalendarProvider({ clock });
    const channel = await local.watch('primary', 'https://crm.vitalpe.cat/api/google/webhook');
    const forged = {
      'x-goog-channel-id': channel.channelId,
      'x-goog-channel-token': 'attacker-guess',
      'x-goog-resource-id': channel.resourceId,
      'x-goog-resource-state': 'exists',
      'x-goog-message-number': '99',
    };
    const result = verifyChannel(forged, channel);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('INVALID_TOKEN');
  });

  it('recovers from an expired sync token with a full resync', async () => {
    const clock = new TestClock();
    const local = new LocalCalendarProvider({ clock });
    const crm = crmEvent({}, '2026-07-23T09:00:00.000Z');
    const created = await local.createEvent('primary', crm);
    const token = (await local.listChanged({ calendarId: 'primary' })).nextSyncToken as string;

    local.editDirectly('primary', created.id, { location: 'Nova adreça' });
    local.expireSyncTokens();

    let recovered = false;
    try {
      await local.listChanged({ calendarId: 'primary', syncToken: token });
    } catch (error) {
      expect(error).toBeInstanceOf(SyncTokenInvalidError);
      expect((error as SyncTokenInvalidError).requiresFullResync).toBe(true);
      const full = await local.listChanged({ calendarId: 'primary' });
      expect(full.events).toHaveLength(1);
      expect(full.nextSyncToken).toBeDefined();
      recovered = true;
    }
    expect(recovered).toBe(true);
  });

  it('cancels the visit when the event is deleted in the calendar', async () => {
    const clock = new TestClock();
    const local = new LocalCalendarProvider({ clock });
    const crm = crmEvent({}, '2026-07-23T09:00:00.000Z');
    const created = await local.createEvent('primary', crm);
    const link = linkAfterPush(
      {
        visitId: crm.visitId,
        calendarId: 'primary',
        googleEventId: created.id,
        lastChangeOrigin: 'CRM',
        status: 'PENDENT',
      },
      created,
      crmToContent(crm),
      clock.now(),
    );

    clock.advance(60_000);
    await local.deleteEvent('primary', created.id);
    const remote = await local.getEvent('primary', created.id);
    expect(remote?.status).toBe('cancelled');

    const decision = reconcile({ link, crm, remote });
    expect(decision.type).toBe('CANCEL_VISIT_IN_CRM');

    // The visit row itself is untouched — only its status changes.
    const cancelled: CrmEvent = { ...crm, status: 'CANCELLED' };
    expect(cancelled.visitId).toBe(crm.visitId);
    expect(reconcile({ link, crm: cancelled, remote }).type).toBe('NOOP');
  });

  it('surfaces an ETag conflict when the calendar moved under us', async () => {
    const clock = new TestClock();
    const local = new LocalCalendarProvider({ clock });
    const crm = crmEvent({}, '2026-07-23T09:00:00.000Z');
    const created = await local.createEvent('primary', crm);

    // Someone edits in Google after we read the ETag.
    local.editDirectly('primary', created.id, { summary: 'Editat a Google' });

    await expect(
      local.updateEvent('primary', created.id, crm, { etag: created.etag }),
    ).rejects.toMatchObject({ name: 'EtagConflictError' });
  });

  it('keeps the stored hash meaningful across a push/pull cycle', async () => {
    const clock = new TestClock();
    const local = new LocalCalendarProvider({ clock });
    const crm = crmEvent({}, '2026-07-23T09:00:00.000Z');
    const created = await local.createEvent('primary', crm);
    const link = linkAfterPush(
      {
        visitId: crm.visitId,
        calendarId: 'primary',
        googleEventId: created.id,
        lastChangeOrigin: 'CRM',
        status: 'PENDENT',
      },
      created,
      crmToContent(crm),
      clock.now(),
    );
    expect(link.contentHash).toBe(contentHash(crmToContent(crm)));
    // What the provider echoes back hashes to the same value.
    const fetched = await local.getEvent('primary', created.id);
    expect(reconcile({ link, crm, remote: fetched }).type).toBe('NOOP');
  });
});
