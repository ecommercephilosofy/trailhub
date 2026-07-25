/**
 * The weekly route suggestion.
 *
 * What this does: it looks at the working list, works out which companies are
 * *due* a visit and why, groups them by zone, and proposes one zone per working
 * day so a day's driving stays inside one comarca.
 *
 * What this deliberately does NOT do: claim to be an optimal route. There are
 * no coordinates in this portfolio — not one geocoded address — so there is no
 * distance to optimise and any "shortest path" would be fiction. The claim is
 * weaker and true: *these companies are due, and these ones are near each
 * other.* The order inside a day is by urgency, not by geography.
 *
 * Every stop carries the reasons it was chosen. A suggestion a commercial
 * cannot audit is one he will stop trusting the first time it looks odd, and he
 * is the one who knows that a given cellar is shut on Mondays.
 *
 * Pure module: the clock is an argument, nothing here reads a database.
 */
import { zoneFor } from './zones';
import { haversineMeters, type LatLng } from './geo';

export interface RouteCandidate {
  clientId: string;
  name: string;
  municipality: string | null;
  province: string | null;
  /** Confirmed classification, or the proposal when nobody confirmed one. */
  classification: string | null;
  priority: string | null;
  /** Open tasks at this company. */
  openTasks: number;
  /** Of those, how many are past their due date. */
  overdueTasks: number;
  /** Earliest due date among open tasks. */
  nextDueAt: Date | string | null;
  /** Last activity of any kind. Null when never contacted. */
  lastContactAt: Date | string | null;
  /** Litres forecast or bought this campaign; drives how much a visit is worth. */
  volumeLiters: number | null;
  /** A visit already booked; the planner leaves those alone. */
  hasScheduledVisit?: boolean;
  /** Set once the address has been geocoded. Absent until then. */
  latitude?: number | null;
  longitude?: number | null;
}

export interface ScoredStop {
  candidate: RouteCandidate;
  zone: string;
  zoneKnown: boolean;
  score: number;
  /** Why this company is on the list, in the order the reasons were applied. */
  reasons: string[];
  daysSinceContact: number | null;
}

/** Weights, in one place, so the ranking can be argued with. */
export const WEIGHTS = Object.freeze({
  overdueTask: 22,
  overdueTaskCap: 66,
  taskDueThisWeek: 18,
  openTask: 6,
  openTaskCap: 18,
  activeCustomer: 14,
  interestedProspect: 11,
  highPriority: 10,
  mediumPriority: 4,
  neverContacted: 8,
  silence60: 10,
  silence120: 18,
  silence240: 24,
  volumePerDecade: 5,
  volumeCap: 15,
});

const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * How much attention this company is owed, and why.
 *
 * Scores are additive and bounded so no single signal can dominate: a company
 * with eleven overdue tasks should rise, but not above every other company put
 * together.
 */
export function scoreCandidate(candidate: RouteCandidate, now: Date): ScoredStop {
  const reasons: string[] = [];
  let score = 0;

  if (candidate.overdueTasks > 0) {
    const points = Math.min(candidate.overdueTasks * WEIGHTS.overdueTask, WEIGHTS.overdueTaskCap);
    score += points;
    reasons.push(
      candidate.overdueTasks === 1
        ? '1 tasca vençuda'
        : `${candidate.overdueTasks} tasques vençudes`,
    );
  }

  const due = toDate(candidate.nextDueAt);
  if (due !== null && candidate.overdueTasks === 0) {
    const inDays = (due.getTime() - now.getTime()) / DAY_MS;
    if (inDays >= 0 && inDays <= 7) {
      score += WEIGHTS.taskDueThisWeek;
      reasons.push('té una tasca amb data aquesta setmana');
    }
  }

  const otherOpen = Math.max(0, candidate.openTasks - candidate.overdueTasks);
  if (otherOpen > 0) {
    score += Math.min(otherOpen * WEIGHTS.openTask, WEIGHTS.openTaskCap);
    reasons.push(otherOpen === 1 ? '1 tasca oberta' : `${otherOpen} tasques obertes`);
  }

  if (candidate.classification === 'ACTIU SEGUR') {
    score += WEIGHTS.activeCustomer;
    reasons.push('client actiu: cal mantenir-lo calent');
  } else if (candidate.classification === 'POTENCIAL INTERESSAT') {
    score += WEIGHTS.interestedProspect;
    reasons.push('potencial que ja ha mostrat interès');
  }

  if (candidate.priority === 'ALTA') {
    score += WEIGHTS.highPriority;
    reasons.push('prioritat ALTA');
  } else if (candidate.priority === 'MITJANA') {
    score += WEIGHTS.mediumPriority;
  }

  const last = toDate(candidate.lastContactAt);
  let daysSinceContact: number | null = null;
  if (last === null) {
    score += WEIGHTS.neverContacted;
    reasons.push('mai contactat');
  } else {
    daysSinceContact = Math.floor((now.getTime() - last.getTime()) / DAY_MS);
    if (daysSinceContact >= 240) {
      score += WEIGHTS.silence240;
      reasons.push(`fa ${daysSinceContact} dies que no s'hi parla`);
    } else if (daysSinceContact >= 120) {
      score += WEIGHTS.silence120;
      reasons.push(`fa ${daysSinceContact} dies que no s'hi parla`);
    } else if (daysSinceContact >= 60) {
      score += WEIGHTS.silence60;
      reasons.push(`fa ${daysSinceContact} dies que no s'hi parla`);
    }
  }

  const litres = candidate.volumeLiters ?? 0;
  if (litres > 0) {
    // Logarithmic: the difference between 1.000 L and 10.000 L matters more
    // than between 100.000 L and 110.000 L.
    const points = Math.min(Math.log10(litres) * WEIGHTS.volumePerDecade, WEIGHTS.volumeCap);
    score += points;
    reasons.push(`${Math.round(litres).toLocaleString('ca-ES')} L en joc`);
  }

  const { zone, known } = zoneFor(candidate.municipality, candidate.province);
  return {
    candidate,
    zone,
    zoneKnown: known,
    score: Math.round(score * 10) / 10,
    reasons,
    daysSinceContact,
  };
}

export interface ZoneWeight {
  zone: string;
  zoneKnown: boolean;
  stops: ScoredStop[];
  /** Sum of the best `maxStopsPerDay` stops: what a day there would be worth. */
  dayValue: number;
  totalScore: number;
}

/** Groups scored stops by zone, best zones first. */
export function groupByZone(stops: readonly ScoredStop[], maxStopsPerDay: number): ZoneWeight[] {
  const byZone = new Map<string, ScoredStop[]>();
  for (const stop of stops) {
    const list = byZone.get(stop.zone);
    if (list === undefined) byZone.set(stop.zone, [stop]);
    else list.push(stop);
  }

  const zones: ZoneWeight[] = [];
  for (const [zone, list] of byZone) {
    const sorted = [...list].sort((a, b) => b.score - a.score);
    const dayValue = sorted.slice(0, maxStopsPerDay).reduce((sum, s) => sum + s.score, 0);
    zones.push({
      zone,
      zoneKnown: sorted[0]?.zoneKnown ?? false,
      stops: sorted,
      dayValue: Math.round(dayValue * 10) / 10,
      totalScore: Math.round(sorted.reduce((sum, s) => sum + s.score, 0) * 10) / 10,
    });
  }
  return zones.sort((a, b) => b.dayValue - a.dayValue);
}

export interface RouteDay {
  /** `YYYY-MM-DD` in Europe/Madrid. */
  date: string;
  weekdayIndex: number;
  zone: string;
  zoneKnown: boolean;
  stops: ScoredStop[];
  dayValue: number;
  /**
   * Metres of driving between the stops, in the order given — null when any
   * stop in the day is not geocoded, because a partial total would understate
   * the real trip and read as if it were the whole thing.
   */
  travelMeters: number | null;
  /** True when every stop that day has coordinates and the order is by proximity. */
  orderedByDistance: boolean;
}

export interface WeekPlan {
  /** `YYYY-MM-DD` of the Monday the plan starts on. */
  weekStart: string;
  days: RouteDay[];
  /** Zones that qualified but did not fit in the week. */
  deferred: ZoneWeight[];
  /** Companies with no municipality at all: they cannot be routed. */
  unroutable: ScoredStop[];
  /** Companies already having a booked visit; left for the calendar to own. */
  alreadyScheduled: ScoredStop[];
}

export interface PlanWeekOptions {
  now: Date;
  /** Monday of the week to plan. Defaults to the Monday on or after `now`. */
  weekStart?: Date;
  /** How many companies fit in one working day. Default 5. */
  maxStopsPerDay?: number;
  /** Which weekdays are worked, 1 = Monday. Default Monday–Friday. */
  workingDays?: readonly number[];
  /** A zone with fewer than this many due companies is not worth a trip. Default 2. */
  minStopsPerZone?: number;
  /** Ignore anything scoring below this. Default 10. */
  minScore?: number;
}

/** `YYYY-MM-DD` for a date, read in Europe/Madrid. */
function civilDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '01';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** ISO weekday in Europe/Madrid: 1 = Monday … 7 = Sunday. */
function weekday(date: Date): number {
  const name = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid',
    weekday: 'short',
  }).format(date);
  const order = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const index = order.indexOf(name);
  return index === -1 ? 1 : index + 1;
}

/**
 * Builds a week of suggested routes.
 *
 * One zone per day: the point of the whole exercise is that a day's driving
 * stays inside one comarca. A zone with only one due company does not justify
 * the trip and is deferred rather than padded out with companies nobody needs
 * to see.
 */
export function planWeek(
  candidates: readonly RouteCandidate[],
  options: PlanWeekOptions,
): WeekPlan {
  const now = options.now;
  const maxStopsPerDay = options.maxStopsPerDay ?? 5;
  const workingDays = options.workingDays ?? [1, 2, 3, 4, 5];
  const minStopsPerZone = options.minStopsPerZone ?? 2;
  const minScore = options.minScore ?? 10;

  const scored = candidates.map((c) => scoreCandidate(c, now));

  const alreadyScheduled = scored.filter((s) => s.candidate.hasScheduledVisit === true);
  const routable = scored.filter((s) => s.candidate.hasScheduledVisit !== true);

  const unroutable = routable.filter((s) => s.zone === 'SENSE MUNICIPI');
  const eligible = routable.filter((s) => s.zone !== 'SENSE MUNICIPI' && s.score >= minScore);

  const zones = groupByZone(eligible, maxStopsPerDay).filter(
    (z) => z.stops.length >= minStopsPerZone,
  );

  // The Monday of the target week.
  const start = options.weekStart ?? nextMonday(now);
  const weekStart = civilDate(start);

  const days: RouteDay[] = [];
  let zoneIndex = 0;
  for (const offset of [0, 1, 2, 3, 4, 5, 6]) {
    const date = new Date(start.getTime() + offset * DAY_MS);
    const dow = weekday(date);
    if (!workingDays.includes(dow)) continue;
    const zone = zones[zoneIndex];
    if (zone === undefined) break;
    zoneIndex += 1;
    const chosen = zone.stops.slice(0, maxStopsPerDay);
    // Urgency picks WHO to see; geography decides in WHAT ORDER, but only when
    // every stop is geocoded.
    const ordered = orderByProximity(chosen);
    days.push({
      date: civilDate(date),
      weekdayIndex: dow,
      zone: zone.zone,
      zoneKnown: zone.zoneKnown,
      stops: ordered.stops,
      dayValue: Math.round(chosen.reduce((sum, s) => sum + s.score, 0) * 10) / 10,
      travelMeters: ordered.travelMeters,
      orderedByDistance: ordered.ordered,
    });
  }

  return {
    weekStart,
    days,
    deferred: zones.slice(zoneIndex),
    unroutable,
    alreadyScheduled,
  };
}

function coordsOf(stop: ScoredStop): LatLng | null {
  const { latitude, longitude } = stop.candidate;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

/**
 * Orders a day's stops by proximity: nearest-neighbour from the most urgent one.
 *
 * Nearest-neighbour is not optimal — the travelling salesman is not solved
 * here — but on five stops inside one comarca it is within a few minutes of
 * optimal and it is explainable, which matters more. The most urgent company
 * anchors the chain so the day still starts where it should.
 *
 * Returns the stops unchanged when any of them lacks coordinates: a half-sorted
 * day would imply a geography that is not known.
 */
export function orderByProximity(stops: readonly ScoredStop[]): {
  stops: ScoredStop[];
  travelMeters: number | null;
  ordered: boolean;
} {
  if (stops.length <= 1) {
    return { stops: [...stops], travelMeters: stops.length === 0 ? null : 0, ordered: stops.length === 1 };
  }
  const points = stops.map(coordsOf);
  if (points.some((p) => p === null)) {
    return { stops: [...stops], travelMeters: null, ordered: false };
  }

  const remaining = stops.map((stop, index) => ({ stop, point: points[index] as LatLng }));
  // Highest score first: the day starts at the company that most needs it.
  remaining.sort((a, b) => b.stop.score - a.stop.score);

  const route = [remaining.shift()!];
  let metres = 0;
  while (remaining.length > 0) {
    const from = route[route.length - 1]!.point;
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const [index, entry] of remaining.entries()) {
      const distance = haversineMeters(from, entry.point);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    metres += bestDistance;
    route.push(remaining.splice(bestIndex, 1)[0]!);
  }

  return { stops: route.map((r) => r.stop), travelMeters: Math.round(metres), ordered: true };
}

/** The next Monday on or after `from`, at 00:00 of that civil day. */
export function nextMonday(from: Date): Date {
  const dow = weekday(from);
  const delta = dow === 1 ? 0 : (8 - dow) % 7;
  return new Date(from.getTime() + delta * DAY_MS);
}
