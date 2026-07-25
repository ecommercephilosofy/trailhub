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

export * from './normalize';
export * from './similarity';
export * from './classification';
export * from './classification.fixtures';
export * from './dedupe';
export * from './taskRules';
export * from './geo';
export * from './geofence';
export * from './dates';
export * from './quickCapture';
export * from './zones';
export * from './routing';
