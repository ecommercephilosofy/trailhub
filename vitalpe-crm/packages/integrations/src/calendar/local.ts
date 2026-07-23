/**
 * The no-credentials calendar provider.
 *
 * This is not a stub. It implements the same contract as the Google adapter —
 * ETags, `If-Match` conflicts, incremental sync tokens that can expire, watch
 * channels that emit notifications with increasing message numbers, cancelled
 * (not deleted) events — so the entire calendar feature, including the
 * reconciliation engine and the webhook path, can be run and tested end to end
 * without a single Google credential. It is also what the app degrades to when
 * `GOOGLE_CLIENT_ID` is absent.
 *
 * State lives in memory, and optionally in a JSON file so a dev server keeps
 * its calendar across restarts.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { systemClock, type Clock } from '../util/http';
import {
  CalendarError,
  EtagConflictError,
  EventGoneError,
  SyncTokenInvalidError,
  type CalendarProvider,
  type CalendarSummary,
  type ChangeList,
  type CrmEvent,
  type DeleteOptions,
  type ListChangedOptions,
  type RemoteEvent,
  type UpdateOptions,
  type WatchChannel,
} from './types';

interface StoredEvent {
  id: string;
  calendarId: string;
  sequence: number;
  updated: string;
  status: 'confirmed' | 'tentative' | 'cancelled';
  summary: string;
  location?: string;
  description: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  identity: {
    crmWorkspaceId?: string;
    crmClientId?: string;
    crmVisitId?: string;
    crmTaskId?: string;
  };
}

interface StoredChannel {
  channelId: string;
  resourceId: string;
  verificationToken: string;
  expiresAt: string;
  calendarId: string;
  webhookUrl: string;
  messageNumber: number;
}

interface StoreState {
  calendars: Record<string, CalendarSummary>;
  events: Record<string, StoredEvent>;
  channels: Record<string, StoredChannel>;
  sequence: number;
  /** Tokens issued at or below this sequence are no longer valid (410). */
  horizon: number;
}

/**
 * Shape of the headers Google sends; the local provider emits the same.
 * A type alias rather than an interface so it satisfies `HeaderBag` directly.
 */
export type LocalNotification = {
  readonly 'x-goog-channel-id': string;
  readonly 'x-goog-channel-token': string;
  readonly 'x-goog-resource-id': string;
  readonly 'x-goog-resource-state': 'sync' | 'exists';
  readonly 'x-goog-message-number': string;
  readonly 'x-goog-channel-expiration': string;
};

export interface LocalCalendarOptions {
  /** Persist to this JSON file. Omit for pure in-memory. */
  readonly filePath?: string;
  readonly clock?: Clock;
  readonly defaultTimeZone?: string;
  readonly defaultCalendarId?: string;
  /** Deterministic id generation for tests. */
  readonly idFactory?: (kind: 'event' | 'calendar' | 'channel' | 'resource' | 'token') => string;
}

const SYNC_TOKEN_PREFIX = 'local-sync-';
const WATCH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class LocalCalendarProvider implements CalendarProvider {
  readonly name = 'local';

  private readonly clock: Clock;
  private readonly filePath: string | undefined;
  private readonly defaultTimeZone: string;
  private readonly idFactory: (kind: 'event' | 'calendar' | 'channel' | 'resource' | 'token') => string;
  private counter = 0;
  private state: StoreState;
  private notifications: LocalNotification[] = [];

  constructor(options: LocalCalendarOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.filePath = options.filePath;
    this.defaultTimeZone = options.defaultTimeZone ?? 'Europe/Madrid';
    this.idFactory =
      options.idFactory ??
      ((kind) => {
        this.counter += 1;
        return `local-${kind}-${this.counter}`;
      });

    const primaryId = options.defaultCalendarId ?? 'primary';
    this.state = this.load() ?? {
      calendars: {
        [primaryId]: {
          id: primaryId,
          summary: 'Calendari principal',
          primary: true,
          timeZone: this.defaultTimeZone,
          accessRole: 'owner',
        },
      },
      events: {},
      channels: {},
      sequence: 0,
      horizon: 0,
    };
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  async createEvent(calendarId: string, event: CrmEvent): Promise<RemoteEvent> {
    this.requireCalendar(calendarId);
    const id = this.idFactory('event');
    const stored = this.write(calendarId, id, event, 'create');
    return toRemote(stored);
  }

  async updateEvent(
    calendarId: string,
    eventId: string,
    event: CrmEvent,
    options: UpdateOptions = {},
  ): Promise<RemoteEvent> {
    this.requireCalendar(calendarId);
    const existing = this.state.events[key(calendarId, eventId)];
    if (!existing) throw new EventGoneError(eventId);
    if (options.etag !== undefined && options.etag !== etagOf(existing)) {
      // Same semantics as Google's 412 on a stale `If-Match`.
      throw new EtagConflictError(eventId);
    }
    const stored = this.write(calendarId, eventId, event, 'update');
    return toRemote(stored);
  }

  async deleteEvent(calendarId: string, eventId: string, options: DeleteOptions = {}): Promise<void> {
    this.requireCalendar(calendarId);
    const existing = this.state.events[key(calendarId, eventId)];
    if (!existing || existing.status === 'cancelled') throw new EventGoneError(eventId);
    if (options.etag !== undefined && options.etag !== etagOf(existing)) {
      throw new EtagConflictError(eventId);
    }
    this.state.sequence += 1;
    existing.status = 'cancelled';
    existing.sequence = this.state.sequence;
    existing.updated = this.clock.now().toISOString();
    this.emit(calendarId);
    this.persist();
  }

  async getEvent(calendarId: string, eventId: string): Promise<RemoteEvent | null> {
    const existing = this.state.events[key(calendarId, eventId)];
    return existing ? toRemote(existing) : null;
  }

  async listChanged(options: ListChangedOptions): Promise<ChangeList> {
    const { calendarId, syncToken, workspaceId, maxResults } = options;
    this.requireCalendar(calendarId);

    let since = 0;
    if (syncToken !== undefined) {
      since = parseSyncToken(syncToken);
      if (since < this.state.horizon) {
        // Google returns 410 GONE for a token that has aged out.
        throw new SyncTokenInvalidError();
      }
    }

    const all = Object.values(this.state.events)
      .filter((e) => e.calendarId === calendarId)
      .filter((e) => (syncToken === undefined ? e.status !== 'cancelled' : e.sequence > since))
      .filter((e) => workspaceId === undefined || e.identity.crmWorkspaceId === workspaceId)
      .sort((a, b) => a.sequence - b.sequence);

    const limited = maxResults === undefined ? all : all.slice(0, maxResults);
    const truncated = limited.length < all.length;
    const highWater = limited.length > 0 ? (limited[limited.length - 1] as StoredEvent).sequence : since;

    return {
      events: limited.map(toRemote),
      ...(truncated
        ? { nextPageToken: `${SYNC_TOKEN_PREFIX}${highWater}` }
        : { nextSyncToken: `${SYNC_TOKEN_PREFIX}${this.state.sequence}` }),
    };
  }

  // -------------------------------------------------------------------------
  // Watch channels
  // -------------------------------------------------------------------------

  async watch(calendarId: string, webhookUrl: string): Promise<WatchChannel> {
    this.requireCalendar(calendarId);
    const channel: StoredChannel = {
      channelId: this.idFactory('channel'),
      resourceId: this.idFactory('resource'),
      verificationToken: this.idFactory('token'),
      expiresAt: new Date(this.clock.now().getTime() + WATCH_TTL_MS).toISOString(),
      calendarId,
      webhookUrl,
      messageNumber: 0,
    };
    this.state.channels[channel.channelId] = channel;
    this.persist();
    // Google always opens with a `sync` notification.
    this.pushNotification(channel, 'sync');
    return {
      channelId: channel.channelId,
      resourceId: channel.resourceId,
      verificationToken: channel.verificationToken,
      expiresAt: channel.expiresAt,
      calendarId,
    };
  }

  async stopWatch(channel: Pick<WatchChannel, 'channelId' | 'resourceId'>): Promise<void> {
    // Stopping an unknown channel is a no-op: a renewal job must be able to
    // clean up after a crash without a missing channel taking it down.
    delete this.state.channels[channel.channelId];
    this.persist();
  }

  // -------------------------------------------------------------------------
  // Calendars
  // -------------------------------------------------------------------------

  async createCalendar(name: string): Promise<CalendarSummary> {
    const id = this.idFactory('calendar');
    const calendar: CalendarSummary = {
      id,
      summary: name,
      primary: false,
      timeZone: this.defaultTimeZone,
      accessRole: 'owner',
    };
    this.state.calendars[id] = calendar;
    this.persist();
    return calendar;
  }

  async listCalendars(): Promise<readonly CalendarSummary[]> {
    return Object.values(this.state.calendars);
  }

  // -------------------------------------------------------------------------
  // Test / dev affordances
  // -------------------------------------------------------------------------

  /** Notifications this provider would have POSTed, oldest first. */
  drainNotifications(): LocalNotification[] {
    const out = this.notifications;
    this.notifications = [];
    return out;
  }

  /** Simulates Google ageing out every issued sync token (410 on next use). */
  expireSyncTokens(): void {
    this.state.horizon = this.state.sequence + 1;
    this.persist();
  }

  /** Simulates an out-of-band edit made directly in the calendar UI. */
  editDirectly(
    calendarId: string,
    eventId: string,
    patch: Partial<Pick<StoredEvent, 'summary' | 'location' | 'description'>> & {
      startsAt?: string;
      endsAt?: string;
      status?: StoredEvent['status'];
    },
  ): RemoteEvent {
    const existing = this.state.events[key(calendarId, eventId)];
    if (!existing) throw new EventGoneError(eventId);
    this.state.sequence += 1;
    if (patch.summary !== undefined) existing.summary = patch.summary;
    if (patch.location !== undefined) existing.location = patch.location;
    if (patch.description !== undefined) existing.description = patch.description;
    if (patch.status !== undefined) existing.status = patch.status;
    if (patch.startsAt !== undefined) existing.start = { dateTime: patch.startsAt, timeZone: existing.start.timeZone };
    if (patch.endsAt !== undefined) existing.end = { dateTime: patch.endsAt, timeZone: existing.end.timeZone };
    existing.sequence = this.state.sequence;
    existing.updated = this.clock.now().toISOString();
    this.emit(calendarId);
    this.persist();
    return toRemote(existing);
  }

  /** Current watch channels, for the renewal planner. */
  listChannels(): readonly WatchChannel[] {
    return Object.values(this.state.channels).map((c) => ({
      channelId: c.channelId,
      resourceId: c.resourceId,
      verificationToken: c.verificationToken,
      expiresAt: c.expiresAt,
      calendarId: c.calendarId,
    }));
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private requireCalendar(calendarId: string): void {
    if (!this.state.calendars[calendarId]) {
      throw new CalendarError(`El calendari «${calendarId}» no existeix.`, 404);
    }
  }

  private write(
    calendarId: string,
    eventId: string,
    event: CrmEvent,
    mode: 'create' | 'update',
  ): StoredEvent {
    this.state.sequence += 1;
    const previous = this.state.events[key(calendarId, eventId)];
    const location = event.location?.trim();
    const stored: StoredEvent = {
      id: eventId,
      calendarId,
      sequence: this.state.sequence,
      updated: this.clock.now().toISOString(),
      status:
        event.status === 'CANCELLED'
          ? 'cancelled'
          : event.status === 'TENTATIVE'
            ? 'tentative'
            : 'confirmed',
      summary: event.title,
      ...(location ? { location } : {}),
      description: event.description,
      start: { dateTime: event.startsAt, timeZone: event.timeZone },
      end: { dateTime: event.endsAt, timeZone: event.timeZone },
      identity: {
        crmWorkspaceId: event.workspaceId,
        crmClientId: event.clientId,
        crmVisitId: event.visitId,
        ...(event.taskId === undefined ? {} : { crmTaskId: event.taskId }),
      },
    };
    // A full write replaces the record, so an omitted location clears it —
    // the same semantics as Google's PUT (as opposed to PATCH).
    void previous;
    void mode;
    this.state.events[key(calendarId, eventId)] = stored;
    this.emit(calendarId);
    this.persist();
    return stored;
  }

  private emit(calendarId: string): void {
    for (const channel of Object.values(this.state.channels)) {
      if (channel.calendarId === calendarId) this.pushNotification(channel, 'exists');
    }
  }

  private pushNotification(channel: StoredChannel, state: 'sync' | 'exists'): void {
    channel.messageNumber += 1;
    this.notifications.push({
      'x-goog-channel-id': channel.channelId,
      'x-goog-channel-token': channel.verificationToken,
      'x-goog-resource-id': channel.resourceId,
      'x-goog-resource-state': state,
      'x-goog-message-number': String(channel.messageNumber),
      'x-goog-channel-expiration': channel.expiresAt,
    });
  }

  private load(): StoreState | undefined {
    if (!this.filePath || !existsSync(this.filePath)) return undefined;
    try {
      return JSON.parse(readFileSync(this.filePath, 'utf8')) as StoreState;
    } catch {
      // A corrupt dev file must not take the app down; start clean.
      return undefined;
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf8');
  }
}

function key(calendarId: string, eventId: string): string {
  return `${calendarId}::${eventId}`;
}

/** Weak ETag derived from the change counter — monotone, like Google's. */
function etagOf(event: StoredEvent): string {
  return `W/"local-${event.sequence}"`;
}

function toRemote(event: StoredEvent): RemoteEvent {
  return {
    id: event.id,
    calendarId: event.calendarId,
    etag: etagOf(event),
    updated: event.updated,
    status: event.status,
    summary: event.summary,
    ...(event.location === undefined ? {} : { location: event.location }),
    description: event.description,
    start: event.start,
    end: event.end,
    identity: { ...event.identity },
  };
}

function parseSyncToken(token: string): number {
  if (!token.startsWith(SYNC_TOKEN_PREFIX)) throw new SyncTokenInvalidError();
  const value = Number(token.slice(SYNC_TOKEN_PREFIX.length));
  if (!Number.isInteger(value) || value < 0) throw new SyncTokenInvalidError();
  return value;
}
