/**
 * Catalan error reporting for every schema in this package.
 *
 * The database already rejects bad writes — that is where correctness lives.
 * These schemas exist so the user learns what is missing BEFORE the round trip,
 * in the language the app is written in, with the field named.
 */

import { z } from 'zod';

/**
 * Replaces zod's English defaults. Applied by {@link parseOrThrow} and
 * {@link safeParse}; it is deliberately NOT installed globally with
 * `z.setErrorMap`, so importing this package cannot change the behaviour of
 * unrelated zod usage elsewhere in the monorepo.
 */
export const caErrorMap: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === 'undefined' || issue.received === 'null') {
        return { message: 'Aquest camp és obligatori.' };
      }
      return { message: `S’esperava ${issue.expected} i s’ha rebut ${issue.received}.` };
    case z.ZodIssueCode.invalid_enum_value:
      return {
        message: `Valor no permès. Valors vàlids: ${issue.options.join(', ')}.`,
      };
    case z.ZodIssueCode.invalid_union_discriminator:
      return {
        message: `Tipus d’acció no permès. Valors vàlids: ${issue.options.join(', ')}.`,
      };
    case z.ZodIssueCode.too_small:
      if (issue.type === 'string') {
        return issue.minimum === 1
          ? { message: 'No pot estar buit.' }
          : { message: `Ha de tenir com a mínim ${issue.minimum} caràcters.` };
      }
      if (issue.type === 'array') {
        return { message: `Cal com a mínim ${issue.minimum} element(s).` };
      }
      return {
        message: issue.inclusive
          ? `Ha de ser més gran o igual que ${issue.minimum}.`
          : `Ha de ser més gran que ${issue.minimum}.`,
      };
    case z.ZodIssueCode.too_big:
      if (issue.type === 'string') {
        return { message: `Ha de tenir com a màxim ${issue.maximum} caràcters.` };
      }
      return {
        message: issue.inclusive
          ? `Ha de ser més petit o igual que ${issue.maximum}.`
          : `Ha de ser més petit que ${issue.maximum}.`,
      };
    case z.ZodIssueCode.invalid_string:
      if (issue.validation === 'uuid') return { message: 'Identificador no vàlid.' };
      if (issue.validation === 'email') return { message: 'Adreça de correu no vàlida.' };
      if (issue.validation === 'datetime') return { message: 'Data i hora no vàlides.' };
      if (issue.validation === 'url') return { message: 'Adreça web no vàlida.' };
      return { message: 'Format no vàlid.' };
    case z.ZodIssueCode.unrecognized_keys:
      return { message: `Camps no reconeguts: ${issue.keys.join(', ')}.` };
    case z.ZodIssueCode.not_finite:
      return { message: 'Ha de ser un número.' };
    default:
      return { message: ctx.defaultError };
  }
};

export interface ValidationIssue {
  /** Dotted path to the offending field, '' for the object itself. */
  path: string;
  message: string;
}

/** Thrown by {@link parseOrThrow}. Carries every issue, not just the first. */
export class ValidationError extends Error {
  readonly issues: ValidationIssue[];
  readonly context: string | undefined;

  constructor(issues: ValidationIssue[], context?: string) {
    const head = context === undefined ? 'Dades no vàlides' : `Dades no vàlides a ${context}`;
    super(`${head}: ${issues.map((i) => (i.path === '' ? i.message : `${i.path}: ${i.message}`)).join(' ')}`);
    this.name = 'ValidationError';
    this.issues = issues;
    this.context = context;
  }
}

export function formatIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/** Parses with Catalan messages, throwing {@link ValidationError} on failure. */
export function parseOrThrow<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
  context?: string,
): z.infer<T> {
  const result = schema.safeParse(data, { errorMap: caErrorMap });
  if (result.success) return result.data as z.infer<T>;
  throw new ValidationError(formatIssues(result.error), context);
}

export type SafeParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: ValidationError };

/** Non-throwing twin of {@link parseOrThrow}, for form submit handlers. */
export function safeParse<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
  context?: string,
): SafeParseResult<z.infer<T>> {
  const result = schema.safeParse(data, { errorMap: caErrorMap });
  if (result.success) return { success: true, data: result.data as z.infer<T> };
  return { success: false, error: new ValidationError(formatIssues(result.error), context) };
}
