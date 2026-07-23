/** Shared primitives every write schema builds on. */

import { z } from 'zod';

export const uuid = z.string().uuid('Identificador no vàlid.');

/** A required text field: present, and not just whitespace. */
export const requiredText = (message = 'Aquest camp és obligatori.') =>
  z
    .string({ required_error: message, invalid_type_error: message })
    .trim()
    .min(1, message);

/** An optional text field: '' and whitespace-only collapse to null. */
export const optionalText = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value))
  .nullish();

/** True when a value carries no usable text — the SQL `nullif(btrim(x), '')` test. */
export function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === '';
}

/** ISO 8601 timestamp, as `timestamptz` columns are exchanged over PostgREST. */
export const isoDateTime = z
  .string()
  .datetime({ offset: true, message: 'Data i hora no vàlides.' })
  .or(z.string().datetime({ message: 'Data i hora no vàlides.' }));

/** ISO calendar date (`date` columns). */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no vàlida (format esperat AAAA-MM-DD).');

/** `numeric(12,2) check (> 0)` — the volume columns. */
export const positiveVolume = z
  .number({ invalid_type_error: 'El volum ha de ser un número.' })
  .finite('El volum ha de ser un número.')
  .positive('El volum ha de ser més gran que 0.');
