/**
 * @vitalpe/integrations — every outbound integration, behind a port.
 *
 * The rule that shapes this package: **the app must work with none of them.**
 * Each port has a real, functional local implementation that is selected
 * automatically when the corresponding environment variable is absent —
 * a working in-memory calendar, a manual-transcript path, a rule-based
 * interpreter, and a geocoder that says "PENDENT DE GEOLOCALITZAR" instead of
 * inventing coordinates. A missing credential degrades a feature; it never
 * crashes the app.
 *
 * Every network adapter takes an injectable `fetch`, so nothing in this
 * package touches the network in a test, and nothing logs a secret: all
 * diagnostic output goes through `redact()`.
 */
export * from './calendar/index';
export * from './voice/index';
export * from './geocoding/index';
export {
  redact,
  redactString,
  scrubEmbeddedSecrets,
  safeLogLine,
  REDACTED,
} from './util/redact';
export {
  backoffDelayMs,
  fakeClock,
  parseRetryAfter,
  systemClock,
  DEFAULT_RETRY,
  HttpError,
  type Clock,
  type FetchLike,
  type RetryPolicy,
} from './util/http';
