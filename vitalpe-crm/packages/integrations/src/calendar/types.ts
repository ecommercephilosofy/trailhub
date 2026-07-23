/**
 * Provider-agnostic calendar port.
 *
 * `GoogleCalendarProvider` and `LocalCalendarProvider` both implement
 * `CalendarProvider`, with the same ETag and sync-token semantics, so the
 * whole bidirectional-sync feature is exercisable end to end with no Google
 * credentials at all.
 *
 * Types are declared locally on purpose: this package must not depend on
 * `@vitalpe/domain` while it is being built in parallel. Wiring happens later.
 */

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/** Mirrors `app.change_origin` in the schema. */
export type ChangeOrigin = 'CRM' | 'GOOGLE CALENDAR' | 'IMPORTACIO' | 'VEU' | 'MOBIL' | 'SISTEMA';

/** Mirrors `app.sync_status`. */
export type SyncStatus = 'NO SINCRONITZAT' | 'PENDENT' | 'SINCRONITZAT' | 'ERROR';

/** Mirrors `app.visit_status`. */
export type VisitStatus = 'PLANIFICADA' | 'CONFIRMADA' | 'FETA' | 'CANCEL·LADA';

/** The subset of an event that is actually synchronised, and nothing else. */
export interface EventContent {
  readonly title: string;
  /** Verified visit address, or `undefined` when the address is not verified. */
  readonly location?: string;
  readonly description: string;
  /** ISO-8601 instant. */
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timeZone: string;
  readonly status: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
  /** Minutes before the start, as popup reminders. */
  readonly reminderMinutes?: readonly number[];
}

/** The CRM's side of a link: identity plus content plus bookkeeping. */
export interface CrmEvent extends EventContent {
  readonly workspaceId: string;
  readonly clientId: string;
  readonly visitId: string;
  readonly taskId?: string;
  /** When the CRM row last changed, ISO-8601. Used to order simultaneous edits. */
  readonly updatedAt?: string;
}

/** Identity carried on the remote event as private extended properties. */
export interface CrmIdentity {
  readonly crmWorkspaceId: string;
  readonly crmClientId: string;
  readonly crmVisitId: string;
  readonly crmTaskId?: string;
}

/** What a provider returns for a remote event. */
export interface RemoteEvent {
  readonly id: string;
  readonly calendarId: string;
  readonly etag: string;
  /** ISO-8601 instant of the provider's last modification. */
  readonly updated: string;
  readonly status: 'confirmed' | 'tentative' | 'cancelled';
  readonly summary?: string;
  readonly location?: string;
  readonly description?: string;
  readonly start?: { readonly dateTime?: string; readonly date?: string; readonly timeZone?: string };
  readonly end?: { readonly dateTime?: string; readonly date?: string; readonly timeZone?: string };
  readonly identity: Partial<CrmIdentity>;
  readonly htmlLink?: string;
}

export interface CalendarSummary {
  readonly id: string;
  readonly summary: string;
  readonly primary?: boolean;
  readonly timeZone?: string;
  readonly accessRole?: string;
}

export interface ChangeList {
  readonly events: readonly RemoteEvent[];
  /** Opaque token to pass to the next incremental call. */
  readonly nextSyncToken?: string;
  /** Set when the provider paginated; call again with it. */
  readonly nextPageToken?: string;
}

export interface WatchChannel {
  readonly channelId: string;
  readonly resourceId: string;
  /** Secret echoed back by the provider in every notification. */
  readonly verificationToken: string;
  /** ISO-8601 instant. */
  readonly expiresAt: string;
  readonly calendarId: string;
}

/** Result of one reconciliation step, suitable for an audit row. */
export type SyncOutcome =
  | { readonly kind: 'NOOP'; readonly reason: string }
  | { readonly kind: 'PUSHED'; readonly remote: RemoteEvent; readonly contentHash: string }
  | { readonly kind: 'PULLED'; readonly changes: EventContent; readonly contentHash: string }
  | { readonly kind: 'CANCELLED_IN_CRM'; readonly reason: string }
  | { readonly kind: 'GONE'; readonly reason: string }
  | { readonly kind: 'CONFLICT'; readonly report: ConflictReport }
  | { readonly kind: 'ERROR'; readonly message: string };

export interface ConflictReport {
  readonly visitId: string;
  readonly calendarId: string;
  readonly googleEventId: string;
  /** Fields whose value differs between the two sides. */
  readonly fields: readonly string[];
  readonly crm: EventContent;
  readonly remote: EventContent;
  readonly crmUpdatedAt?: string;
  readonly remoteUpdatedAt?: string;
  readonly detectedAt: string;
  readonly message: string;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface UpdateOptions {
  /** Stored ETag; sent as `If-Match`. Omit to force an unconditional write. */
  readonly etag?: string;
}

export interface DeleteOptions {
  readonly etag?: string;
  /** Ask the provider to notify guests. Defaults to `false`. */
  readonly sendUpdates?: boolean;
}

export interface ListChangedOptions {
  readonly calendarId: string;
  /** Omit for the initial full synchronisation. */
  readonly syncToken?: string;
  readonly pageToken?: string;
  /** Restrict to events this CRM owns. Providers use private properties. */
  readonly workspaceId?: string;
  readonly maxResults?: number;
}

// ---------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------

export interface CalendarProvider {
  readonly name: string;

  createEvent(calendarId: string, event: CrmEvent): Promise<RemoteEvent>;
  updateEvent(
    calendarId: string,
    eventId: string,
    event: CrmEvent,
    options?: UpdateOptions,
  ): Promise<RemoteEvent>;
  /** Never hard-deletes on the CRM side; on the provider it is a real delete. */
  deleteEvent(calendarId: string, eventId: string, options?: DeleteOptions): Promise<void>;
  /** Resolves to `null` when the event is gone (404) rather than throwing. */
  getEvent(calendarId: string, eventId: string): Promise<RemoteEvent | null>;
  /** Incremental sync. Throws {@link SyncTokenInvalidError} on an expired token. */
  listChanged(options: ListChangedOptions): Promise<ChangeList>;
  watch(calendarId: string, webhookUrl: string): Promise<WatchChannel>;
  stopWatch(channel: Pick<WatchChannel, 'channelId' | 'resourceId'>): Promise<void>;
  createCalendar(name: string): Promise<CalendarSummary>;
  listCalendars(): Promise<readonly CalendarSummary[]>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class CalendarError extends Error {
  override readonly name: string = 'CalendarError';
  readonly status?: number;

  constructor(message: string, status?: number, options?: { cause?: unknown }) {
    super(message, options);
    this.status = status;
  }
}

/** 401 after a refresh attempt, or a revoked grant. Reconnect required. */
export class CalendarAuthError extends CalendarError {
  override readonly name = 'CalendarAuthError';
}

/** 403 for a reason that is not rate limiting. */
export class CalendarPermissionError extends CalendarError {
  override readonly name = 'CalendarPermissionError';
}

/** 404: the event no longer exists on the provider. Report, do not crash. */
export class EventGoneError extends CalendarError {
  override readonly name = 'EventGoneError';
  readonly eventId: string;

  constructor(eventId: string, message?: string) {
    super(message ?? `L'esdeveniment «${eventId}» ja no existeix al calendari remot.`, 404);
    this.eventId = eventId;
  }
}

/** 410: the sync token is no longer usable. Signals a full resynchronisation. */
export class SyncTokenInvalidError extends CalendarError {
  override readonly name = 'SyncTokenInvalidError';
  /** Always `true`: callers must drop the token and start a full sync. */
  readonly requiresFullResync = true as const;

  constructor(message = 'El testimoni de sincronització ha caducat: cal una sincronització completa.') {
    super(message, 410);
  }
}

/** 412: the stored ETag no longer matches. Someone else wrote first. */
export class EtagConflictError extends CalendarError {
  override readonly name = 'EtagConflictError';
  readonly eventId: string;

  constructor(eventId: string, message?: string) {
    super(
      message ??
        `L'esdeveniment «${eventId}» s'ha modificat al calendari remot des de l'última sincronització.`,
      412,
    );
    this.eventId = eventId;
  }
}

export class CalendarRateLimitError extends CalendarError {
  override readonly name = 'CalendarRateLimitError';
}
