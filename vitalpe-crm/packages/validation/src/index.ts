/**
 * @vitalpe/validation — zod schemas for every write path.
 *
 * Each schema enforces the SAME rule as the corresponding SQL CHECK constraint
 * or `raise exception`, so the user is told what is missing in Catalan before a
 * round trip. The database remains the authority: nothing here is a substitute
 * for the constraint, only a friendlier first line.
 */

export * from './common.js';
export * from './errors.js';
export * from './crm.js';
export * from './ops.js';
export * from './voice.js';
