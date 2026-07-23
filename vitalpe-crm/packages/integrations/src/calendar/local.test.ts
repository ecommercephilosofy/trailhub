import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalCalendarProvider } from './local';
import { buildCrmEvent, type EventContentInput } from './sync';
import { EtagConflictError, EventGoneError, SyncTokenInvalidError, type CrmEvent } from './types';

class TestClock {
  private ms = Date.parse('2026-07-23T09:00:00.000Z');
  now = (): Date => new Date(this.ms);
  sleep = async (): Promise<void> => {};
  random = (): number => 0.5;
  advance(ms: number): void {
    this.ms += ms;
  }
}

const INPUT: EventContentInput = {
  companyName: 'Caves Solé Germans',
  clientId: 'cli-42',
  visitId: 'vis-7',
  appUrl: 'https://crm.vitalpe.cat',
  startsAt: '2026-07-28T09:00:00.000Z',
  endsAt: '2026-07-28T10:00:00.000Z',
  address: { formatted: 'Camí del Celler 12', verified: true },
  primaryContact: { name: 'Marta Solé', phone: '+34 938 000 111' },
  objective: 'Presentar la gamma',
};

function event(overrides: Partial<EventContentInput> = {}, visitId = 'vis-7'): CrmEvent {
  return buildCrmEvent(
    { workspaceId: 'ws-1', clientId: 'cli-42', visitId },
    { ...INPUT, visitId, ...overrides },
  );
}

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('LocalCalendarProvider', () => {
  it('creates, reads and updates events with monotone ETags', async () => {
    const provider = new LocalCalendarProvider({ clock: new TestClock() });
    const created = await provider.createEvent('primary', event());
    expect(created.id).toMatch(/^local-event-/);
    expect(created.etag).toBe('W/"local-1"');
    expect(created.summary).toBe('VISITA — CAVES SOLÉ GERMANS');
    expect(created.identity).toEqual({
      crmWorkspaceId: 'ws-1',
      crmClientId: 'cli-42',
      crmVisitId: 'vis-7',
    });

    const fetched = await provider.getEvent('primary', created.id);
    expect(fetched?.etag).toBe(created.etag);

    const updated = await provider.updateEvent(
      'primary',
      created.id,
      event({ objective: 'Objectiu nou' }),
      { etag: created.etag },
    );
    expect(updated.etag).not.toBe(created.etag);
    expect(updated.description).toContain('Objectiu nou');
  });

  it('rejects a stale If-Match with an ETag conflict', async () => {
    const provider = new LocalCalendarProvider({ clock: new TestClock() });
    const created = await provider.createEvent('primary', event());
    await provider.updateEvent('primary', created.id, event({ objective: 'A' }), {
      etag: created.etag,
    });
    await expect(
      provider.updateEvent('primary', created.id, event({ objective: 'B' }), {
        etag: created.etag, // stale
      }),
    ).rejects.toBeInstanceOf(EtagConflictError);
  });

  it('turns a deletion into a cancelled event, never a missing one', async () => {
    const provider = new LocalCalendarProvider({ clock: new TestClock() });
    const created = await provider.createEvent('primary', event());
    await provider.deleteEvent('primary', created.id);

    const after = await provider.getEvent('primary', created.id);
    expect(after).not.toBeNull();
    expect(after?.status).toBe('cancelled');

    await expect(provider.deleteEvent('primary', created.id)).rejects.toBeInstanceOf(EventGoneError);
  });

  it('returns null for an unknown event instead of throwing', async () => {
    const provider = new LocalCalendarProvider({ clock: new TestClock() });
    expect(await provider.getEvent('primary', 'nope')).toBeNull();
  });

  it('supports incremental sync with tokens', async () => {
    const clock = new TestClock();
    const provider = new LocalCalendarProvider({ clock });
    await provider.createEvent('primary', event({}, 'vis-1'));
    const first = await provider.listChanged({ calendarId: 'primary' });
    expect(first.events).toHaveLength(1);
    expect(first.nextSyncToken).toBeDefined();

    // Nothing happened: an incremental call returns nothing.
    const quiet = await provider.listChanged({
      calendarId: 'primary',
      syncToken: first.nextSyncToken as string,
    });
    expect(quiet.events).toHaveLength(0);

    clock.advance(60_000);
    await provider.createEvent('primary', event({}, 'vis-2'));
    const second = await provider.listChanged({
      calendarId: 'primary',
      syncToken: first.nextSyncToken as string,
    });
    expect(second.events).toHaveLength(1);
    expect(second.events[0]?.identity.crmVisitId).toBe('vis-2');
  });

  it('signals a full resync when the sync token has aged out', async () => {
    const provider = new LocalCalendarProvider({ clock: new TestClock() });
    await provider.createEvent('primary', event());
    const { nextSyncToken } = await provider.listChanged({ calendarId: 'primary' });

    provider.expireSyncTokens();

    await expect(
      provider.listChanged({ calendarId: 'primary', syncToken: nextSyncToken as string }),
    ).rejects.toBeInstanceOf(SyncTokenInvalidError);

    // A full sync (no token) still works — that is the recovery path.
    const full = await provider.listChanged({ calendarId: 'primary' });
    expect(full.events).toHaveLength(1);
  });

  it('filters incremental results by workspace', async () => {
    const provider = new LocalCalendarProvider({ clock: new TestClock() });
    await provider.createEvent('primary', event());
    await provider.createEvent('primary', {
      ...event({}, 'vis-other'),
      workspaceId: 'ws-2',
    });
    const mine = await provider.listChanged({ calendarId: 'primary', workspaceId: 'ws-1' });
    expect(mine.events).toHaveLength(1);
    expect(mine.events[0]?.identity.crmWorkspaceId).toBe('ws-1');
  });

  it('opens watch channels that emit numbered notifications', async () => {
    const provider = new LocalCalendarProvider({ clock: new TestClock() });
    const channel = await provider.watch('primary', 'https://crm.vitalpe.cat/api/google/webhook');
    expect(channel.verificationToken).toBeTruthy();
    expect(Date.parse(channel.expiresAt)).toBeGreaterThan(Date.parse('2026-07-23T09:00:00.000Z'));

    const created = await provider.createEvent('primary', event());
    provider.editDirectly('primary', created.id, { location: 'Nova adreça' });

    const notifications = provider.drainNotifications();
    expect(notifications[0]?.['x-goog-resource-state']).toBe('sync');
    expect(notifications.map((n) => n['x-goog-message-number'])).toEqual(['1', '2', '3']);
    expect(new Set(notifications.map((n) => n['x-goog-channel-token']))).toEqual(
      new Set([channel.verificationToken]),
    );

    await provider.stopWatch(channel);
    await provider.createEvent('primary', event({}, 'vis-9'));
    expect(provider.drainNotifications()).toHaveLength(0);
  });

  it('creates and lists calendars', async () => {
    const provider = new LocalCalendarProvider({ clock: new TestClock() });
    expect(await provider.listCalendars()).toHaveLength(1);
    const created = await provider.createCalendar('Visites Vitalpe');
    expect(created.summary).toBe('Visites Vitalpe');
    const all = await provider.listCalendars();
    expect(all).toHaveLength(2);
    expect(all.find((c) => c.primary)?.id).toBe('primary');
  });

  it('persists to a JSON file across instances', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vitalpe-cal-'));
    tempDirs.push(dir);
    const filePath = join(dir, 'calendar.json');

    const first = new LocalCalendarProvider({ clock: new TestClock(), filePath });
    const created = await first.createEvent('primary', event());

    const second = new LocalCalendarProvider({ clock: new TestClock(), filePath });
    const reloaded = await second.getEvent('primary', created.id);
    expect(reloaded?.summary).toBe('VISITA — CAVES SOLÉ GERMANS');
    expect(reloaded?.etag).toBe(created.etag);
  });
});
