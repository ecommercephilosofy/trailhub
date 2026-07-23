import { describe, expect, it } from 'vitest';
import {
  arrivalConfidence,
  IOS_MAX_MONITORED_REGIONS,
  isInCooldown,
  selectRegions,
  type GeofenceCandidate,
} from './geofence.js';

/** 2026-07-23 is a Thursday; 12:00 Europe/Madrid = 10:00 UTC. */
const NOW = new Date('2026-07-23T10:00:00Z');

let counter = 0;
const candidate = (overrides: Partial<GeofenceCandidate> = {}): GeofenceCandidate => {
  counter += 1;
  return {
    regionId: `r${counter}`,
    clientId: `c${counter}`,
    locationId: `l${counter}`,
    latitude: 41.3451,
    longitude: 1.6989,
    ...overrides,
  };
};

/** Where the phone last was, and a point far enough away to be out of range. */
const HERE = { latitude: 41.3451, longitude: 1.6989 };
const FAR = { latitude: 42.6, longitude: 2.9 };

describe('selectRegions — prioritisation (§23.3)', () => {
  it('orders the seven tiers exactly as the brief specifies', () => {
    // Everything except `near` sits far from the last known position, so each
    // candidate can only qualify for the tier it is named after.
    const pinned = candidate({ regionId: 'pinned', isPinned: true, ...FAR });
    const recentlyVisited = candidate({
      regionId: 'recent',
      lastVisitedAt: '2026-07-20T10:00:00Z',
      ...FAR,
    });
    const near = candidate({ regionId: 'near', latitude: 41.35, longitude: 1.7 });
    const highPriorityTask = candidate({ regionId: 'task', hasHighPriorityTask: true, ...FAR });
    const assigned = candidate({ regionId: 'assigned', isAssigned: true, ...FAR });
    const upcomingVisit = candidate({
      regionId: 'upcoming',
      visitStartsAt: '2026-07-26T09:00:00Z',
      ...FAR,
    });
    const todayVisit = candidate({
      regionId: 'today',
      visitStartsAt: '2026-07-23T16:00:00Z',
      ...FAR,
    });

    const selected = selectRegions(
      [pinned, recentlyVisited, near, highPriorityTask, assigned, upcomingVisit, todayVisit],
      { now: NOW, lastKnownPosition: HERE },
    );

    expect(selected.map((r) => r.regionId)).toEqual([
      'today',
      'upcoming',
      'assigned',
      'task',
      'near',
      'recent',
      'pinned',
    ]);
    expect(selected.map((r) => r.selectionReason)).toEqual([
      'VISITA AVUI',
      'VISITA PROPERA',
      'CLIENT ASSIGNAT',
      'TASCA PRIORITARIA',
      'PROP DE LA ULTIMA POSICIO',
      'VISITAT RECENTMENT',
      'FIXAT MANUALMENT',
    ]);
    expect(selected.map((r) => r.priority)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('counts a visit earlier today as VISITA AVUI, not as an upcoming one', () => {
    const morning = candidate({ regionId: 'morning', visitStartsAt: '2026-07-23T07:00:00Z' });
    const [region] = selectRegions([morning], { now: NOW });
    expect(region?.selectionReason).toBe('VISITA AVUI');
  });

  it('ignores a visit further ahead than upcomingVisitDays', () => {
    const faraway = candidate({ regionId: 'far', visitStartsAt: '2026-09-01T09:00:00Z' });
    expect(selectRegions([faraway], { now: NOW })).toEqual([]);
  });

  it('takes the highest tier a candidate qualifies for', () => {
    const both = candidate({ regionId: 'both', isPinned: true, isAssigned: true });
    const [region] = selectRegions([both], { now: NOW });
    expect(region?.selectionReason).toBe('CLIENT ASSIGNAT');
    expect(region?.priority).toBe(3);
  });

  it('sorts today’s visits by time, soonest first', () => {
    const late = candidate({ regionId: 'late', visitStartsAt: '2026-07-23T17:00:00Z' });
    const early = candidate({ regionId: 'early', visitStartsAt: '2026-07-23T12:00:00Z' });
    const selected = selectRegions([late, early], { now: NOW });
    expect(selected.map((r) => r.regionId)).toEqual(['early', 'late']);
  });

  it('sorts the "near" tier by distance', () => {
    const far = candidate({ regionId: 'far', latitude: 41.5, longitude: 1.9 });
    const close = candidate({ regionId: 'close', latitude: 41.3455, longitude: 1.699 });
    const selected = selectRegions([far, close], { now: NOW, lastKnownPosition: HERE });
    expect(selected.map((r) => r.regionId)).toEqual(['close', 'far']);
  });

  it('sorts "recently visited" by most recent first', () => {
    const older = candidate({ regionId: 'older', lastVisitedAt: '2026-07-01T10:00:00Z' });
    const newer = candidate({ regionId: 'newer', lastVisitedAt: '2026-07-20T10:00:00Z' });
    const selected = selectRegions([older, newer], { now: NOW });
    expect(selected.map((r) => r.regionId)).toEqual(['newer', 'older']);
  });

  it('prefers proximity over "visited recently" when both apply', () => {
    const both = candidate({
      regionId: 'both',
      lastVisitedAt: '2026-07-20T10:00:00Z',
      ...HERE,
    });
    const [region] = selectRegions([both], { now: NOW, lastKnownPosition: HERE });
    expect(region?.selectionReason).toBe('PROP DE LA ULTIMA POSICIO');
  });
});

describe('selectRegions — the hard cap', () => {
  it('defaults to the iOS limit of 20', () => {
    expect(IOS_MAX_MONITORED_REGIONS).toBe(20);
    const many = Array.from({ length: 50 }, (_, i) =>
      candidate({ regionId: `bulk-${i}`, isAssigned: true }),
    );
    expect(selectRegions(many, { now: NOW })).toHaveLength(20);
  });

  it('honours an explicit maxRegions', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      candidate({ regionId: `m-${i}`, isAssigned: true }),
    );
    expect(selectRegions(many, { now: NOW, maxRegions: 3 })).toHaveLength(3);
    expect(selectRegions(many, { now: NOW, maxRegions: 0 })).toHaveLength(0);
  });

  it('drops the low tiers first when the cap bites', () => {
    const lowTier = Array.from({ length: 25 }, (_, i) =>
      candidate({ regionId: `pin-${i}`, isPinned: true }),
    );
    const important = candidate({ regionId: 'today', visitStartsAt: '2026-07-23T16:00:00Z' });
    const selected = selectRegions([...lowTier, important], { now: NOW });
    expect(selected).toHaveLength(20);
    expect(selected[0]?.regionId).toBe('today');
    expect(selected.filter((r) => r.selectionReason === 'FIXAT MANUALMENT')).toHaveLength(19);
  });
});

describe('selectRegions — exclusions', () => {
  it('drops candidates with geofencing switched off', () => {
    const off = candidate({ regionId: 'off', isAssigned: true, geofenceEnabled: false });
    expect(selectRegions([off], { now: NOW })).toEqual([]);
  });

  it('drops candidates with no usable coordinates', () => {
    const broken = candidate({ regionId: 'broken', isAssigned: true, latitude: Number.NaN });
    expect(selectRegions([broken], { now: NOW })).toEqual([]);
  });

  it('drops candidates that match no tier at all', () => {
    expect(selectRegions([candidate({ regionId: 'nothing' })], { now: NOW })).toEqual([]);
  });

  it('deduplicates by regionId', () => {
    const first = candidate({ regionId: 'dup', isAssigned: true });
    const second = candidate({ regionId: 'dup', isPinned: true });
    expect(selectRegions([first, second], { now: NOW })).toHaveLength(1);
  });

  it('carries the location radius through, defaulting to 120 m like the column', () => {
    const withRadius = candidate({ regionId: 'a', isAssigned: true, radiusM: 300 });
    const withoutRadius = candidate({ regionId: 'b', isAssigned: true });
    const selected = selectRegions([withRadius, withoutRadius], { now: NOW });
    expect(selected.find((r) => r.regionId === 'a')?.radiusM).toBe(300);
    expect(selected.find((r) => r.regionId === 'b')?.radiusM).toBe(120);
  });
});

describe('arrivalConfidence (§23.4)', () => {
  const inside = { distanceMeters: 50, radiusMeters: 120, now: NOW };

  it('is ALTA inside the radius with a visit within ±2 h', () => {
    expect(
      arrivalConfidence({ ...inside, nearestVisitStartsAt: '2026-07-23T11:00:00Z' }),
    ).toBe('ALTA');
    expect(
      arrivalConfidence({ ...inside, nearestVisitStartsAt: '2026-07-23T09:00:00Z' }),
    ).toBe('ALTA');
    expect(
      arrivalConfidence({ ...inside, nearestVisitStartsAt: '2026-07-23T12:00:00Z' }),
    ).toBe('ALTA');
  });

  it('is MITJANA inside the radius with no visit to corroborate it', () => {
    expect(arrivalConfidence(inside)).toBe('MITJANA');
    expect(arrivalConfidence({ ...inside, nearestVisitStartsAt: null })).toBe('MITJANA');
  });

  it('is MITJANA when the only visit is outside the ±2 h window', () => {
    expect(
      arrivalConfidence({ ...inside, nearestVisitStartsAt: '2026-07-23T14:00:00Z' }),
    ).toBe('MITJANA');
  });

  it('is AMBIGUA when several companies share the spot, even with a booked visit', () => {
    expect(arrivalConfidence({ ...inside, candidateClientCount: 3 })).toBe('AMBIGUA');
    expect(
      arrivalConfidence({
        ...inside,
        candidateClientCount: 2,
        nearestVisitStartsAt: '2026-07-23T11:00:00Z',
      }),
    ).toBe('AMBIGUA');
  });

  it('is BAIXA for a fast pass-through', () => {
    expect(arrivalConfidence({ ...inside, dwellSeconds: 30 })).toBe('BAIXA');
    expect(arrivalConfidence({ ...inside, speedKmh: 70 })).toBe('BAIXA');
    // Driving past beats both the visit and the ambiguity.
    expect(
      arrivalConfidence({
        ...inside,
        speedKmh: 70,
        candidateClientCount: 4,
        nearestVisitStartsAt: '2026-07-23T11:00:00Z',
      }),
    ).toBe('BAIXA');
  });

  it('is BAIXA outside the radius', () => {
    expect(arrivalConfidence({ distanceMeters: 500, radiusMeters: 120, now: NOW })).toBe('BAIXA');
  });

  it('is inclusive exactly on the radius', () => {
    expect(arrivalConfidence({ distanceMeters: 120, radiusMeters: 120, now: NOW })).toBe('MITJANA');
  });

  it('accepts a long dwell as a real arrival', () => {
    expect(arrivalConfidence({ ...inside, dwellSeconds: 600, speedKmh: 0 })).toBe('MITJANA');
  });
});

describe('isInCooldown', () => {
  it('is quiet for the configured number of hours after the last event', () => {
    expect(isInCooldown('2026-07-23T08:00:00Z', NOW, 6)).toBe(true); // 2 h ago
    expect(isInCooldown('2026-07-23T03:00:00Z', NOW, 6)).toBe(false); // 7 h ago
  });

  it('defaults to the 6 h in notification_settings', () => {
    expect(isInCooldown('2026-07-23T05:30:00Z', NOW)).toBe(true);
    expect(isInCooldown('2026-07-23T03:59:00Z', NOW)).toBe(false);
  });

  it('is not in cooldown when there is no previous event', () => {
    expect(isInCooldown(null, NOW)).toBe(false);
    expect(isInCooldown(undefined, NOW)).toBe(false);
  });

  it('treats a future timestamp (device clock skew) as still in cooldown', () => {
    expect(isInCooldown('2026-07-24T00:00:00Z', NOW)).toBe(true);
  });

  it('is exclusive at exactly the cooldown boundary', () => {
    expect(isInCooldown('2026-07-23T04:00:00Z', NOW, 6)).toBe(false);
  });
});
