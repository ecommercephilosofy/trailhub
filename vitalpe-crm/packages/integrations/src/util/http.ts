/**
 * Shared HTTP plumbing for every network adapter in this package.
 *
 * Two rules:
 *  - the `fetch` implementation is always injectable, so every adapter can be
 *    driven by a fake in tests and never touches the network there;
 *  - retries are bounded, backoff is exponential *with jitter*, and only the
 *    statuses that are actually transient are retried.
 */
import { redact } from './redact';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface Clock {
  now(): Date;
  sleep(ms: number): Promise<void>;
  /** Uniform in [0, 1). Injectable so backoff jitter is deterministic in tests. */
  random(): number;
}

export const systemClock: Clock = {
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: () => Math.random(),
};

/** A clock that never actually waits — for tests. */
export function fakeClock(startIso = '2026-07-23T09:00:00.000Z'): Clock & { slept: number[] } {
  const slept: number[] = [];
  return {
    slept,
    now: () => new Date(startIso),
    sleep: async (ms) => {
      slept.push(ms);
    },
    random: () => 0.5,
  };
}

export interface RetryPolicy {
  /** Number of *retries* after the first attempt. */
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = {
  maxRetries: 4,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
};

/**
 * Exponential backoff with full jitter, capped, honouring `Retry-After`.
 *
 * Full jitter (`random() * exponential`) rather than a fixed multiplier: when
 * a whole workspace's watch channels expire at once, fixed backoff makes every
 * client retry in lockstep and rebuild the same thundering herd.
 */
export function backoffDelayMs(
  attempt: number,
  policy: RetryPolicy,
  random: () => number,
  retryAfterSeconds?: number,
): number {
  if (retryAfterSeconds !== undefined && Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return Math.min(retryAfterSeconds * 1000, policy.maxDelayMs);
  }
  const exponential = Math.min(policy.baseDelayMs * 2 ** attempt, policy.maxDelayMs);
  // Never sleep for zero: a jittered value below the base is still a wait.
  return Math.max(50, Math.floor(exponential * random()));
}

export function parseRetryAfter(response: Response): number | undefined {
  const raw = response.headers?.get?.('retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return seconds;
  const date = Date.parse(raw);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, (date - Date.now()) / 1000);
}

export class HttpError extends Error {
  override readonly name: string = 'HttpError';
  readonly status: number;
  readonly body: string;
  readonly retryable: boolean;

  constructor(message: string, status: number, body: string, retryable: boolean) {
    super(message);
    this.status = status;
    this.body = body;
    this.retryable = retryable;
  }
}

/** Reads a body without ever throwing — used for error reporting only. */
export async function readBodySafely(response: Response, limit = 2000): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, limit);
  } catch {
    return '';
  }
}

export interface RequestContext {
  readonly fetch: FetchLike;
  readonly clock: Clock;
  readonly retry: RetryPolicy;
}

export type RetryDecision =
  | { readonly kind: 'return' }
  | { readonly kind: 'retry'; readonly retryAfterSeconds?: number }
  /** Refresh a credential and retry immediately, at most once. */
  | { readonly kind: 'refresh' }
  | { readonly kind: 'fail'; readonly error: Error };

/**
 * Runs a request with bounded retries.
 *
 * `classify` decides what each response means for the specific API; this
 * helper only owns the loop, the sleeping and the single refresh allowance.
 */
export async function requestWithRetry(
  ctx: RequestContext,
  send: () => Promise<Response>,
  classify: (response: Response) => RetryDecision | Promise<RetryDecision>,
  onRefresh?: () => Promise<void>,
): Promise<Response> {
  let refreshed = false;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= ctx.retry.maxRetries; attempt += 1) {
    let response: Response;
    try {
      response = await send();
    } catch (cause) {
      // Network-level failure: transient by definition.
      lastError = cause instanceof Error ? cause : new Error(String(cause));
      if (attempt === ctx.retry.maxRetries) break;
      await ctx.clock.sleep(backoffDelayMs(attempt, ctx.retry, ctx.clock.random));
      continue;
    }

    const decision = await classify(response);
    if (decision.kind === 'return') return response;
    if (decision.kind === 'fail') throw decision.error;

    if (decision.kind === 'refresh') {
      if (refreshed || !onRefresh) {
        throw new HttpError(
          'Autenticació rebutjada i el testimoni ja s’havia renovat una vegada.',
          response.status,
          await readBodySafely(response),
          false,
        );
      }
      refreshed = true;
      await onRefresh();
      // Retry immediately: this is not congestion, it is a stale token.
      attempt -= 1;
      continue;
    }

    if (attempt === ctx.retry.maxRetries) {
      throw new HttpError(
        `La petició ha fallat després de ${ctx.retry.maxRetries + 1} intents.`,
        response.status,
        await readBodySafely(response),
        true,
      );
    }
    await ctx.clock.sleep(
      backoffDelayMs(attempt, ctx.retry, ctx.clock.random, decision.retryAfterSeconds),
    );
  }

  throw new HttpError(
    `No s’ha pogut connectar després de ${ctx.retry.maxRetries + 1} intents: ${
      lastError ? String(redact(lastError.message)) : 'error de xarxa'
    }`,
    0,
    '',
    true,
  );
}
