/**
 * The offline queue.
 *
 * A commercial in a cellar has no signal. Everything they do there — closing a
 * task, booking a visit, dictating a note — is written to this queue first and
 * to the server second. The queue is the source of truth for "has this
 * happened yet", which is why it is a pure, serialisable data structure rather
 * than a pile of promises: it survives a force-quit because it is just JSON on
 * disk, and it can be reasoned about in a test.
 *
 * Four properties this module exists to guarantee:
 *
 *   ORDERING     operations against the same entity apply in the order they
 *                were made. A "complete" that overtook its own "postpone"
 *                would rewrite history.
 *   IDEMPOTENCY  every entry carries a key generated on the DEVICE, at capture
 *                time. `public.sync_queue_entries` is UNIQUE on
 *                (workspace_id, idempotency_key), so a retry after a reply we
 *                never saw cannot apply twice.
 *   RETRY        transient failures back off exponentially; permanent ones stop
 *                immediately instead of hammering a 400 forever.
 *   CONFLICT     an entry remembers the `updated_at` it was composed against.
 *                If the server has moved on, the entry becomes CONFLICTE and
 *                waits for a human — it never silently overwrites.
 *
 * Pure module: no React, no Expo, no I/O.
 */

/** Operations the field app can perform offline. */
export const SYNC_OPERATIONS = [
  'COMPLETAR_TASCA',
  'AJORNAR_TASCA',
  'PROGRAMAR_TASCA',
  'CREAR_VISITA',
  'ACTUALITZAR_VISITA',
  'CREAR_NOTA_VEU',
  'PUJAR_AUDIO',
  'REGISTRAR_ARRIBADA',
  'DESCARTAR_ARRIBADA',
  'REGISTRAR_ACTIVITAT',
] as const;
export type SyncOperation = (typeof SYNC_OPERATIONS)[number];

/** Mirrors the CHECK on `public.sync_queue_entries.status`. */
export const SYNC_STATUSES = ['PENDENT', 'APLICAT', 'ERROR', 'CONFLICTE'] as const;
export type SyncEntryStatus = (typeof SYNC_STATUSES)[number];

export interface SyncQueueEntry {
  /** Local id (also used as the row id when uploading). */
  id: string;
  idempotencyKey: string;
  operation: SyncOperation;
  /**
   * The thing this operation mutates, e.g. `tasca:<uuid>`. Two entries with the
   * same entityKey are strictly ordered against each other.
   */
  entityKey: string;
  payload: Record<string, unknown>;
  status: SyncEntryStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  /** Not before this instant (backoff). Null = as soon as possible. */
  nextAttemptAt: string | null;
  lastError: string | null;
  /**
   * `updated_at` of the server row when the operation was composed, or null for
   * pure inserts. Conflict detection compares against this.
   */
  baseVersion: string | null;
}

export const MAX_ATTEMPTS = 8;
export const BASE_BACKOFF_MS = 5_000;
export const MAX_BACKOFF_MS = 30 * 60 * 1000;

/**
 * Deterministic exponential backoff: 5 s, 10 s, 20 s … capped at 30 min.
 * No jitter — one device, one queue; the thundering-herd problem does not
 * exist here and determinism makes the behaviour testable.
 */
export function backoffMs(attempts: number): number {
  if (attempts <= 0) return 0;
  const raw = BASE_BACKOFF_MS * 2 ** (attempts - 1);
  return Math.min(raw, MAX_BACKOFF_MS);
}

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

/**
 * The key is built ONCE, when the user acts, and never regenerated on retry.
 * It is deterministic given its inputs so a test can assert it, and it carries
 * a nonce so two identical actions a second apart are still two actions.
 */
export function makeIdempotencyKey(
  operation: SyncOperation,
  entityKey: string,
  occurredAt: string,
  nonce: string,
): string {
  return `${operation}|${entityKey}|${occurredAt}|${nonce}`;
}

export interface EnqueueInput {
  id: string;
  operation: SyncOperation;
  entityKey: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  baseVersion?: string | null;
}

export interface EnqueueResult {
  queue: SyncQueueEntry[];
  entry: SyncQueueEntry;
  /** True when the key was already queued and nothing was added. */
  duplicate: boolean;
}

/**
 * Appends an operation. An idempotency key that is already present is a no-op:
 * a double tap on "FET" is one completion, not two.
 */
export function enqueue(
  queue: readonly SyncQueueEntry[],
  input: EnqueueInput,
  now: Date,
): EnqueueResult {
  const existing = queue.find((e) => e.idempotencyKey === input.idempotencyKey);
  if (existing !== undefined) {
    return { queue: [...queue], entry: existing, duplicate: true };
  }
  const iso = now.toISOString();
  const entry: SyncQueueEntry = {
    id: input.id,
    idempotencyKey: input.idempotencyKey,
    operation: input.operation,
    entityKey: input.entityKey,
    payload: input.payload,
    status: 'PENDENT',
    attempts: 0,
    createdAt: iso,
    updatedAt: iso,
    nextAttemptAt: null,
    lastError: null,
    baseVersion: input.baseVersion ?? null,
  };
  return { queue: [...queue, entry], entry, duplicate: false };
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

function isReady(entry: SyncQueueEntry, now: Date): boolean {
  if (entry.status !== 'PENDENT') return false;
  if (entry.nextAttemptAt === null) return true;
  const at = Date.parse(entry.nextAttemptAt);
  return Number.isNaN(at) ? true : at <= now.getTime();
}

/**
 * The entries to attempt right now, oldest first.
 *
 * Head-of-line blocking is deliberate and per entity: if the oldest pending
 * operation for task X is still backing off, no LATER operation for task X is
 * attempted either. Operations for other entities are unaffected.
 */
export function readyEntries(queue: readonly SyncQueueEntry[], now: Date): SyncQueueEntry[] {
  const ordered = [...queue].sort(byCreation);
  const blocked = new Set<string>();
  const ready: SyncQueueEntry[] = [];
  for (const entry of ordered) {
    if (entry.status === 'CONFLICTE' || entry.status === 'ERROR') {
      // A stuck entry blocks its own entity until a human resolves it.
      blocked.add(entry.entityKey);
      continue;
    }
    if (entry.status !== 'PENDENT') continue;
    if (blocked.has(entry.entityKey)) continue;
    if (!isReady(entry, now)) {
      blocked.add(entry.entityKey);
      continue;
    }
    blocked.add(entry.entityKey); // one in flight per entity
    ready.push(entry);
  }
  return ready;
}

function byCreation(a: SyncQueueEntry, b: SyncQueueEntry): number {
  const diff = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  if (!Number.isNaN(diff) && diff !== 0) return diff;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Everything still waiting to reach the server — the "pending" badge. */
export function pendingCount(queue: readonly SyncQueueEntry[]): number {
  return queue.filter((e) => e.status === 'PENDENT').length;
}

/** Entries that need a human: permanent errors and conflicts. */
export function blockedEntries(queue: readonly SyncQueueEntry[]): SyncQueueEntry[] {
  return queue.filter((e) => e.status === 'ERROR' || e.status === 'CONFLICTE');
}

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

function replace(
  queue: readonly SyncQueueEntry[],
  id: string,
  patch: (entry: SyncQueueEntry) => SyncQueueEntry,
): SyncQueueEntry[] {
  return queue.map((entry) => (entry.id === id ? patch(entry) : entry));
}

export function markApplied(
  queue: readonly SyncQueueEntry[],
  id: string,
  now: Date,
): SyncQueueEntry[] {
  return replace(queue, id, (entry) => ({
    ...entry,
    status: 'APLICAT',
    updatedAt: now.toISOString(),
    nextAttemptAt: null,
    lastError: null,
  }));
}

export interface FailureInfo {
  /** HTTP status when there was one; undefined for a network failure. */
  status?: number | undefined;
  message?: string | undefined;
}

export type FailureClass = 'TRANSITORI' | 'PERMANENT' | 'CONFLICTE';

/**
 * No status at all means the request never landed: transient.
 * 409 is the server telling us the row moved: a conflict, not a retry.
 * 408/425/429 and every 5xx are transient. Everything else in 4xx is a bug in
 * the payload and will never succeed, so it stops.
 */
export function classifyFailure(info: FailureInfo): FailureClass {
  const status = info.status;
  if (status === undefined) return 'TRANSITORI';
  if (status === 409) return 'CONFLICTE';
  if (status === 408 || status === 425 || status === 429) return 'TRANSITORI';
  if (status >= 500) return 'TRANSITORI';
  if (status >= 400) return 'PERMANENT';
  return 'TRANSITORI';
}

/**
 * Records a failed attempt. Transient failures stay PENDENT with a backoff
 * until {@link MAX_ATTEMPTS}, then become ERROR. Permanent failures become
 * ERROR at once — retrying a 422 forever only drains the battery.
 */
export function markFailed(
  queue: readonly SyncQueueEntry[],
  id: string,
  info: FailureInfo,
  now: Date,
): SyncQueueEntry[] {
  const kind = classifyFailure(info);
  return replace(queue, id, (entry) => {
    const attempts = entry.attempts + 1;
    const base = {
      ...entry,
      attempts,
      updatedAt: now.toISOString(),
      lastError: info.message ?? (info.status === undefined ? 'SENSE CONNEXIO' : `HTTP ${info.status}`),
    };
    if (kind === 'CONFLICTE') {
      return { ...base, status: 'CONFLICTE' as const, nextAttemptAt: null };
    }
    if (kind === 'PERMANENT' || attempts >= MAX_ATTEMPTS) {
      return { ...base, status: 'ERROR' as const, nextAttemptAt: null };
    }
    return {
      ...base,
      status: 'PENDENT' as const,
      nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)).toISOString(),
    };
  });
}

/**
 * Optimistic-concurrency check made BEFORE sending: the entry was composed
 * against `baseVersion`; if the server row now reports something else, someone
 * (the web app, a colleague, Google Calendar) changed it in the meantime.
 *
 * A pure insert has no baseVersion and can never conflict.
 */
export function detectConflict(
  entry: Pick<SyncQueueEntry, 'baseVersion'>,
  remoteVersion: string | null | undefined,
): boolean {
  if (entry.baseVersion === null) return false;
  if (remoteVersion === null || remoteVersion === undefined) return false;
  return remoteVersion !== entry.baseVersion;
}

export function markConflict(
  queue: readonly SyncQueueEntry[],
  id: string,
  remoteVersion: string | null,
  now: Date,
): SyncQueueEntry[] {
  return replace(queue, id, (entry) => ({
    ...entry,
    status: 'CONFLICTE',
    updatedAt: now.toISOString(),
    nextAttemptAt: null,
    lastError:
      remoteVersion === null
        ? 'CONFLICTE: la fitxa ha canviat al servidor.'
        : `CONFLICTE: la fitxa ha canviat al servidor (${remoteVersion}).`,
  }));
}

export type ConflictResolution = 'DESCARTAR' | 'REINTENTAR';

/**
 * The two honest answers to a conflict: throw my change away, or re-apply it on
 * top of what the server now has (which requires re-reading the row, hence the
 * new `baseVersion`).
 */
export function resolveConflict(
  queue: readonly SyncQueueEntry[],
  id: string,
  resolution: ConflictResolution,
  now: Date,
  newBaseVersion: string | null = null,
): SyncQueueEntry[] {
  if (resolution === 'DESCARTAR') {
    return queue.filter((entry) => entry.id !== id);
  }
  return replace(queue, id, (entry) => ({
    ...entry,
    status: 'PENDENT',
    attempts: 0,
    nextAttemptAt: null,
    lastError: null,
    baseVersion: newBaseVersion,
    updatedAt: now.toISOString(),
  }));
}

/** Manual "try again" on an entry that gave up. */
export function retryEntry(
  queue: readonly SyncQueueEntry[],
  id: string,
  now: Date,
): SyncQueueEntry[] {
  return replace(queue, id, (entry) =>
    entry.status === 'ERROR'
      ? { ...entry, status: 'PENDENT', attempts: 0, nextAttemptAt: null, lastError: null, updatedAt: now.toISOString() }
      : entry,
  );
}

/** Applied entries older than `keepMs` are dropped; the rest are kept forever. */
export function pruneApplied(
  queue: readonly SyncQueueEntry[],
  now: Date,
  keepMs: number = 7 * 24 * 60 * 60 * 1000,
): SyncQueueEntry[] {
  return queue.filter((entry) => {
    if (entry.status !== 'APLICAT') return true;
    const at = Date.parse(entry.updatedAt);
    return Number.isNaN(at) ? true : now.getTime() - at < keepMs;
  });
}

// ---------------------------------------------------------------------------
// Upload shape
// ---------------------------------------------------------------------------

/** Exactly the columns of `public.sync_queue_entries`. */
export interface SyncQueueRow {
  id: string;
  workspace_id: string;
  user_id: string;
  idempotency_key: string;
  operation: string;
  payload: Record<string, unknown>;
  status: SyncEntryStatus;
  attempts: number;
  last_error: string | null;
}

export function toRemoteRow(
  entry: SyncQueueEntry,
  context: { workspaceId: string; userId: string },
): SyncQueueRow {
  return {
    id: entry.id,
    workspace_id: context.workspaceId,
    user_id: context.userId,
    idempotency_key: entry.idempotencyKey,
    operation: entry.operation,
    payload: entry.payload,
    status: entry.status,
    attempts: entry.attempts,
    last_error: entry.lastError,
  };
}
