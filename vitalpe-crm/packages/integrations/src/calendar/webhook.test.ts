import { describe, expect, it } from 'vitest';
import {
  NotificationDeduplicator,
  constantTimeEqual,
  idempotencyKey,
  renewalPlan,
  verifyChannel,
  type RenewableChannel,
} from './webhook';

const TOKEN = 'secret-channel-token';

function headers(overrides: Record<string, string | undefined> = {}): Record<string, string> {
  const base: Record<string, string | undefined> = {
    'X-Goog-Channel-ID': 'chan-1',
    'X-Goog-Channel-Token': TOKEN,
    'X-Goog-Resource-ID': 'res-1',
    'X-Goog-Resource-State': 'exists',
    'X-Goog-Message-Number': '4',
    'X-Goog-Resource-URI': 'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    ...overrides,
  };
  return Object.fromEntries(
    Object.entries(base).filter(([, v]) => v !== undefined),
  ) as Record<string, string>;
}

describe('verifyChannel', () => {
  it('accepts a well-formed notification with the right token', () => {
    const result = verifyChannel(headers(), TOKEN);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.notification).toMatchObject({
      channelId: 'chan-1',
      resourceId: 'res-1',
      resourceState: 'exists',
      messageNumber: 4,
    });
  });

  it('is case-insensitive about header names and reads a Headers object', () => {
    expect(verifyChannel(new Headers(headers()), TOKEN).ok).toBe(true);
    expect(verifyChannel(new Map(Object.entries(headers())), TOKEN).ok).toBe(true);
  });

  it('rejects a wrong token', () => {
    const result = verifyChannel(headers({ 'X-Goog-Channel-Token': 'not-the-token' }), TOKEN);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('INVALID_TOKEN');
  });

  it('rejects a missing token', () => {
    const result = verifyChannel(headers({ 'X-Goog-Channel-Token': undefined }), TOKEN);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('INVALID_TOKEN');
  });

  it('rejects a notification for a channel we never opened', () => {
    const result = verifyChannel(headers({ 'X-Goog-Channel-ID': 'chan-unknown' }), [
      { channelId: 'chan-1', verificationToken: TOKEN },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('UNKNOWN_CHANNEL');
  });

  it('rejects a request missing the mandatory headers', () => {
    const result = verifyChannel({ 'x-goog-channel-token': TOKEN }, TOKEN);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('MISSING_HEADERS');
  });

  it('looks the token up among the stored channels', () => {
    const stored = [
      { channelId: 'chan-0', verificationToken: 'other' },
      { channelId: 'chan-1', verificationToken: TOKEN },
    ];
    expect(verifyChannel(headers(), stored).ok).toBe(true);
    expect(verifyChannel(headers({ 'X-Goog-Channel-Token': 'other' }), stored).ok).toBe(false);
  });

  it('compares tokens without leaking their length', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('', '')).toBe(true);
  });
});

describe('idempotency', () => {
  it('keys on (channelId, messageNumber) like the database index', () => {
    expect(idempotencyKey('chan-1', 4)).toBe('chan-1#4');
    expect(idempotencyKey('chan-1', undefined)).toBe('chan-1#null');
  });

  it('applies a replayed notification exactly once', () => {
    const dedupe = new NotificationDeduplicator();
    const notification = { channelId: 'chan-1', messageNumber: 4 };
    expect(dedupe.accept(notification)).toBe(true);
    expect(dedupe.accept(notification)).toBe(false);
    expect(dedupe.accept(notification)).toBe(false);
    expect(dedupe.has(notification)).toBe(true);
    // A different message on the same channel is new work.
    expect(dedupe.accept({ channelId: 'chan-1', messageNumber: 5 })).toBe(true);
    // The same number on another channel is new work too.
    expect(dedupe.accept({ channelId: 'chan-2', messageNumber: 4 })).toBe(true);
  });

  it('lets an unnumbered notification through for the database to arbitrate', () => {
    const dedupe = new NotificationDeduplicator();
    expect(dedupe.accept({ channelId: 'chan-1', messageNumber: undefined })).toBe(true);
    expect(dedupe.accept({ channelId: 'chan-1', messageNumber: undefined })).toBe(true);
  });

  it('bounds its memory', () => {
    const dedupe = new NotificationDeduplicator(3);
    for (let i = 0; i < 10; i += 1) dedupe.accept({ channelId: 'c', messageNumber: i });
    expect(dedupe.size).toBeLessThanOrEqual(3);
  });
});

describe('renewalPlan', () => {
  const now = new Date('2026-07-23T09:00:00.000Z');
  const channel = (overrides: Partial<RenewableChannel>): RenewableChannel => ({
    channelId: 'c',
    resourceId: 'r',
    calendarId: 'primary',
    expiresAt: '2026-07-30T09:00:00.000Z',
    status: 'ACTIU',
    ...overrides,
  });

  it('separates healthy, soon-to-expire and already-expired channels', () => {
    const plan = renewalPlan(
      [
        channel({ channelId: 'healthy', expiresAt: '2026-07-30T09:00:00.000Z' }),
        channel({ channelId: 'soon', expiresAt: '2026-07-23T20:00:00.000Z' }),
        channel({ channelId: 'expired', expiresAt: '2026-07-22T09:00:00.000Z' }),
      ],
      now,
    );
    expect(plan.healthy.map((c) => c.channelId)).toEqual(['healthy']);
    expect(plan.toRenew.map((c) => c.channelId)).toEqual(['soon']);
    expect(plan.expired.map((c) => c.channelId)).toEqual(['expired']);
    expect(plan.checkedAt).toBe(now.toISOString());
  });

  it('honours a custom renewal window', () => {
    const plan = renewalPlan([channel({ expiresAt: '2026-07-25T09:00:00.000Z' })], now, {
      renewWithinMs: 3 * 24 * 60 * 60 * 1000,
    });
    expect(plan.toRenew).toHaveLength(1);
  });

  it('ignores channels that are not active', () => {
    const plan = renewalPlan(
      [
        channel({ channelId: 'closed', status: 'TANCAT', expiresAt: '2026-07-22T09:00:00.000Z' }),
        channel({ channelId: 'errored', status: 'ERROR' }),
      ],
      now,
    );
    expect(plan.toRenew).toHaveLength(0);
    expect(plan.expired).toHaveLength(0);
    expect(plan.healthy).toHaveLength(0);
  });

  it('treats an unreadable expiry as expired', () => {
    const plan = renewalPlan([channel({ expiresAt: 'no-idea' })], now);
    expect(plan.expired).toHaveLength(1);
  });
});
