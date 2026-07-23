/**
 * @vitalpe/domain — the business rules, as pure functions.
 *
 * Hard constraints for everything in this package:
 *   - no I/O, no Supabase client, no React, no environment access;
 *   - every function is deterministic given its arguments (the clock is always
 *     passed in as `now`);
 *   - anything that also exists in SQL is a line-by-line transcription of the
 *     SQL, and says so in its doc comment.
 *
 * That is what lets the same rule run in the browser, on the phone (offline)
 * and inside PostgreSQL without three subtly different answers.
 */

export * from './normalize.js';
export * from './similarity.js';
export * from './classification.js';
export * from './classification.fixtures.js';
export * from './dedupe.js';
export * from './taskRules.js';
export * from './geo.js';
export * from './geofence.js';
export * from './dates.js';
export * from './quickCapture.js';
