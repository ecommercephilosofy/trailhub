/**
 * Log redaction.
 *
 * Every adapter in this package logs through `redact()`. Nothing else is
 * allowed to reach a log line, an error message or a `last_error` column: the
 * whole point of encrypting tokens at the application boundary is lost if the
 * same token is then printed while debugging a 401.
 */

const SENSITIVE_KEY = /(token|secret|password|passwd|api[-_]?key|apikey|authorization|auth|credential|signature|cookie|session|bearer|refresh|private[-_]?key|dsn)/i;

/** Values that look like credentials even when the key name is innocent. */
const SENSITIVE_VALUE = [
  /^sk-[A-Za-z0-9_-]{8,}$/, // OpenAI / Anthropic style
  /^ya29\.[A-Za-z0-9._-]{10,}$/, // Google access token
  /^1\/\/[A-Za-z0-9._-]{10,}$/, // Google refresh token
  /^ey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./, // JWT
  /^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/, // our own cipher envelope
];

/**
 * Credential shapes that appear *inside* longer text — an upstream error
 * message, a URL, a serialised body. Matching the whole string is not enough:
 * Google happily echoes the offending token back inside `error.message`.
 */
const EMBEDDED_SECRET_PATTERNS: readonly RegExp[] = [
  /ya29\.[A-Za-z0-9._-]{10,}/g, // Google access token
  /1\/\/[A-Za-z0-9._-]{20,}/g, // Google refresh token
  /sk-[A-Za-z0-9_-]{16,}/g, // OpenAI / Anthropic key
  /ey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, // JWT
  /v1:[A-Za-z0-9+/=]{10,}:[A-Za-z0-9+/=]{10,}:[A-Za-z0-9+/=]+/g, // our envelope
];

/** `token=…`, `"api_key": "…"`, `Authorization: Bearer …` and friends. */
const EMBEDDED_ASSIGNMENT =
  /((?:access_token|refresh_token|id_token|client_secret|api[-_]?key|apikey|password|secret|token|authorization|bearer)["']?\s*[=:]\s*["']?)([^\s,&"'}]{6,})/gi;

export const REDACTED = '[REDACTAT]';

/** Removes credential-shaped substrings from free text. */
export function scrubEmbeddedSecrets(text: string): string {
  let out = text;
  for (const pattern of EMBEDDED_SECRET_PATTERNS) out = out.replace(pattern, REDACTED);
  out = out.replace(EMBEDDED_ASSIGNMENT, (_match, prefix: string) => `${prefix}${REDACTED}`);
  return out;
}

/** Keeps enough of a value to correlate logs, never enough to use it. */
export function redactString(value: string): string {
  if (value.length <= 8) return REDACTED;
  return `${REDACTED}(${value.length} car., …${value.slice(-4)})`;
}

function looksSensitive(value: string): boolean {
  return SENSITIVE_VALUE.some((re) => re.test(value));
}

/**
 * Deep-redacts an arbitrary value for logging.
 *
 * - Object keys matching a credential-ish name are replaced wholesale.
 * - Strings that look like credentials are replaced even under a safe key.
 * - `Authorization`-style HTTP headers are redacted whatever their casing.
 * - Query strings lose the value of any sensitive parameter.
 * - Cycles are rendered as `[Circular]`.
 */
export function redact<T>(value: T, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    if (looksSensitive(value)) return redactString(value);
    return scrubEmbeddedSecrets(redactUrl(value));
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redact(value.message, seen),
    };
  }

  if (value instanceof Date) return value.toISOString();

  if (typeof value === 'object') {
    if (seen.has(value as object)) return '[Circular]';
    seen.add(value as object);

    if (Array.isArray(value)) return value.map((item) => redact(item, seen));

    if (value instanceof Headers) {
      const out: Record<string, unknown> = {};
      value.forEach((headerValue, key) => {
        out[key] = SENSITIVE_KEY.test(key) ? redactString(headerValue) : redact(headerValue, seen);
      });
      return out;
    }

    if (value instanceof Map) {
      const out: Record<string, unknown> = {};
      for (const [key, entry] of value.entries()) {
        const name = String(key);
        out[name] = SENSITIVE_KEY.test(name)
          ? typeof entry === 'string'
            ? redactString(entry)
            : REDACTED
          : redact(entry, seen);
      }
      return out;
    }

    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(key)) {
        out[key] = typeof entry === 'string' ? redactString(entry) : REDACTED;
      } else {
        out[key] = redact(entry, seen);
      }
    }
    return out;
  }

  return REDACTED;
}

/** Strips credential-bearing query parameters from a URL-looking string. */
function redactUrl(value: string): string {
  if (!/^https?:\/\//i.test(value) || !value.includes('?')) return value;
  try {
    const url = new URL(value);
    let changed = false;
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_KEY.test(key)) {
        url.searchParams.set(key, REDACTED);
        changed = true;
      }
    }
    return changed ? url.toString() : value;
  } catch {
    return value;
  }
}

/** Convenience: a one-line, safe representation for a log statement. */
export function safeLogLine(message: string, context?: unknown): string {
  if (context === undefined) return message;
  return `${message} ${JSON.stringify(redact(context))}`;
}
