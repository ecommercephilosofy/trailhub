/**
 * Google Calendar push-notification handling.
 *
 * A notification carries no payload — only headers telling us *that* a
 * calendar changed. Three things have to be right:
 *
 *  1. **Authenticity.** Anyone can POST to a public webhook URL. The only
 *     thing that distinguishes Google is the `X-Goog-Channel-Token` we chose
 *     when opening the channel, so it is compared in constant time and the
 *     channel id must match the one the token belongs to.
 *  2. **Idempotency.** Google retries. `(channelId, messageNumber)` is the
 *     natural key — the same pair as the unique index on
 *     `calendar_sync_events` — so a replay is recorded once and applied once.
 *  3. **Renewal.** Channels expire (a week, at most). Something has to notice
 *     before they do.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

export type HeaderBag =
  | Headers
  | Record<string, string | string[] | undefined>
  | Map<string, string>;

export interface GoogleNotification {
  readonly channelId: string;
  readonly resourceId: string;
  readonly resourceState: 'sync' | 'exists' | 'not_exists' | string;
  readonly messageNumber: number | undefined;
  readonly resourceUri?: string;
  readonly channelExpiration?: string;
}

export type ChannelVerification =
  | { readonly ok: true; readonly notification: GoogleNotification }
  | { readonly ok: false; readonly reason: ChannelRejectionReason; readonly message: string };

export type ChannelRejectionReason =
  | 'MISSING_HEADERS'
  | 'UNKNOWN_CHANNEL'
  | 'INVALID_TOKEN'
  | 'NO_STORED_TOKEN';

export interface StoredChannelSecret {
  readonly channelId: string;
  readonly verificationToken: string;
  readonly resourceId?: string;
}

function headerValue(headers: HeaderBag, name: string): string | undefined {
  const lower = name.toLowerCase();
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return headers.get(lower) ?? undefined;
  }
  if (headers instanceof Map) {
    for (const [key, value] of headers.entries()) {
      if (key.toLowerCase() === lower) return value;
    }
    return undefined;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lower) continue;
    if (Array.isArray(value)) return value[0];
    return value ?? undefined;
  }
  return undefined;
}

/**
 * Constant-time string comparison.
 *
 * Both sides are hashed first so unequal lengths do not short-circuit and leak
 * the token length through timing.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Verifies that a request really came from the channel we opened.
 *
 * `storedToken` is either the token string for the channel named in the
 * headers, or a lookup of the stored channels.
 */
export function verifyChannel(
  headers: HeaderBag,
  storedToken: string | StoredChannelSecret | readonly StoredChannelSecret[] | undefined,
): ChannelVerification {
  const channelId = headerValue(headers, 'x-goog-channel-id');
  const resourceId = headerValue(headers, 'x-goog-resource-id');
  const token = headerValue(headers, 'x-goog-channel-token');
  const resourceState = headerValue(headers, 'x-goog-resource-state');

  if (!channelId || !resourceId || !resourceState) {
    return {
      ok: false,
      reason: 'MISSING_HEADERS',
      message: 'Falten capçaleres obligatòries de l’avís de Google.',
    };
  }

  let expected: string | undefined;
  if (typeof storedToken === 'string') {
    expected = storedToken;
  } else if (Array.isArray(storedToken)) {
    expected = (storedToken as readonly StoredChannelSecret[]).find((c) => c.channelId === channelId)
      ?.verificationToken;
  } else if (storedToken && typeof storedToken === 'object') {
    const single = storedToken as StoredChannelSecret;
    expected = single.channelId === channelId ? single.verificationToken : undefined;
  }

  if (expected === undefined) {
    return {
      ok: false,
      reason: 'UNKNOWN_CHANNEL',
      message: `L’avís esmenta un canal desconegut («${channelId}»).`,
    };
  }
  if (expected.length === 0) {
    return {
      ok: false,
      reason: 'NO_STORED_TOKEN',
      message: 'El canal no té cap testimoni de verificació desat.',
    };
  }
  if (!token || !constantTimeEqual(token, expected)) {
    return {
      ok: false,
      reason: 'INVALID_TOKEN',
      message: 'El testimoni de verificació de l’avís no és correcte.',
    };
  }

  const rawMessageNumber = headerValue(headers, 'x-goog-message-number');
  const messageNumber = rawMessageNumber === undefined ? undefined : Number(rawMessageNumber);

  const resourceUri = headerValue(headers, 'x-goog-resource-uri');
  const channelExpiration = headerValue(headers, 'x-goog-channel-expiration');

  return {
    ok: true,
    notification: {
      channelId,
      resourceId,
      resourceState,
      messageNumber:
        messageNumber !== undefined && Number.isFinite(messageNumber) ? messageNumber : undefined,
      ...(resourceUri === undefined ? {} : { resourceUri }),
      ...(channelExpiration === undefined ? {} : { channelExpiration }),
    },
  };
}

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

/** Matches the unique index on `calendar_sync_events (channel_id, message_number)`. */
export function idempotencyKey(channelId: string, messageNumber: number | undefined): string {
  return `${channelId}#${messageNumber ?? 'null'}`;
}

/**
 * In-memory replay guard.
 *
 * The durable guard is the unique index on `calendar_sync_events`; this is the
 * cheap first line that keeps a burst of retries from doing the same work
 * several times inside one process.
 */
export class NotificationDeduplicator {
  private readonly seen = new Map<string, number>();

  constructor(private readonly maxEntries = 5000) {}

  /** `true` the first time a notification is seen, `false` on every replay. */
  accept(notification: Pick<GoogleNotification, 'channelId' | 'messageNumber'>): boolean {
    // A notification without a message number cannot be de-duplicated by key;
    // treat it as new and let the database's unique index decide.
    if (notification.messageNumber === undefined) return true;
    const key = idempotencyKey(notification.channelId, notification.messageNumber);
    if (this.seen.has(key)) return false;
    this.seen.set(key, Date.now());
    if (this.seen.size > this.maxEntries) {
      const oldest = this.seen.keys().next();
      if (!oldest.done) this.seen.delete(oldest.value);
    }
    return true;
  }

  has(notification: Pick<GoogleNotification, 'channelId' | 'messageNumber'>): boolean {
    if (notification.messageNumber === undefined) return false;
    return this.seen.has(idempotencyKey(notification.channelId, notification.messageNumber));
  }

  get size(): number {
    return this.seen.size;
  }
}

// ---------------------------------------------------------------------------
// Renewal
// ---------------------------------------------------------------------------

export interface RenewableChannel {
  readonly channelId: string;
  readonly resourceId: string;
  readonly calendarId: string;
  readonly connectionId?: string;
  /** ISO-8601 instant. */
  readonly expiresAt: string;
  readonly status?: 'ACTIU' | 'CADUCAT' | 'TANCAT' | 'ERROR';
}

export interface RenewalPlan {
  /** Still valid, but inside the renewal window: reopen then stop the old one. */
  readonly toRenew: readonly RenewableChannel[];
  /** Already past their expiry: reopen, nothing to stop. */
  readonly expired: readonly RenewableChannel[];
  /** Comfortably valid: leave alone. */
  readonly healthy: readonly RenewableChannel[];
  readonly checkedAt: string;
}

export interface RenewalOptions {
  /** Renew when less than this remains. Default 24 h. */
  readonly renewWithinMs?: number;
}

const DEFAULT_RENEW_WITHIN_MS = 24 * 60 * 60 * 1000;

/**
 * Decides which watch channels need reopening.
 *
 * Renewing a day early is deliberate: a channel that lapses stops delivering
 * silently, and the first symptom is a user asking why a calendar edit never
 * reached the CRM.
 */
export function renewalPlan(
  channels: readonly RenewableChannel[],
  now: Date,
  options: RenewalOptions = {},
): RenewalPlan {
  const within = options.renewWithinMs ?? DEFAULT_RENEW_WITHIN_MS;
  const nowMs = now.getTime();
  const toRenew: RenewableChannel[] = [];
  const expired: RenewableChannel[] = [];
  const healthy: RenewableChannel[] = [];

  for (const channel of channels) {
    if (channel.status !== undefined && channel.status !== 'ACTIU') continue;
    const expiresAt = Date.parse(channel.expiresAt);
    if (Number.isNaN(expiresAt)) {
      // An unreadable expiry is treated as expired: reopening is cheap,
      // missing notifications for a week is not.
      expired.push(channel);
      continue;
    }
    if (expiresAt <= nowMs) expired.push(channel);
    else if (expiresAt - nowMs <= within) toRenew.push(channel);
    else healthy.push(channel);
  }

  return { toRenew, expired, healthy, checkedAt: now.toISOString() };
}
