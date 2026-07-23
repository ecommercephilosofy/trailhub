/**
 * Audio retention policy.
 *
 * A voice note is the rawest personal data the product holds: a recording of a
 * commercial talking about a named client, often in a car, often mentioning
 * things that never belong in a CRM field. The transcript is what the business
 * needs; the audio is a means to it. This engine decides when the recording
 * has served its purpose and must go.
 *
 * The policies mirror the `retention_policy` column on `public.voice_notes`.
 */

export const RETENTION_POLICIES = [
  'KEEP',
  'DELETE_AFTER_TRANSCRIPTION',
  'DELETE_AFTER_CONFIRM',
  'KEEP_DAYS',
] as const;
export type RetentionPolicy = (typeof RETENTION_POLICIES)[number];

/** Mirrors `app.voice_stage_status`. */
export type VoiceStageStatus = 'PENDENT' | 'EN PROCES' | 'FET' | 'ERROR' | 'NO DISPONIBLE';

/** The columns of `voice_notes` this decision depends on. */
export interface RetentionSubject {
  readonly retention_policy: string;
  readonly retention_days?: number | null;
  readonly audio_path?: string | null;
  readonly audio_deleted_at?: string | null;
  readonly transcription_status?: VoiceStageStatus | string | null;
  readonly confirmed_at?: string | null;
  readonly created_at: string;
}

export type RetentionReason =
  | 'NO_AUDIO'
  | 'ALREADY_DELETED'
  | 'KEEP_FOREVER'
  | 'AWAITING_TRANSCRIPTION'
  | 'TRANSCRIBED'
  | 'AWAITING_CONFIRMATION'
  | 'CONFIRMED'
  | 'WITHIN_RETENTION_WINDOW'
  | 'RETENTION_WINDOW_ELAPSED'
  | 'INVALID_POLICY'
  | 'MISSING_RETENTION_DAYS';

export interface RetentionDecision {
  readonly delete: boolean;
  readonly reason: RetentionReason;
  /** Catalan explanation, safe to show in the UI or write to an audit row. */
  readonly explanation: string;
  /** When the audio becomes deletable, for KEEP_DAYS. */
  readonly deletableAt?: string;
}

export function isRetentionPolicy(value: unknown): value is RetentionPolicy {
  return typeof value === 'string' && (RETENTION_POLICIES as readonly string[]).includes(value);
}

/**
 * Decides whether a voice note's audio should be deleted now.
 *
 * Pure and total: an unknown policy or a missing `retention_days` never
 * deletes. Erring towards keeping is recoverable; erring towards deleting is
 * not.
 */
export function shouldDeleteAudio(note: RetentionSubject, now: Date): RetentionDecision {
  if (!note.audio_path || note.audio_path.trim().length === 0) {
    return {
      delete: false,
      reason: 'NO_AUDIO',
      explanation: 'La nota no té cap fitxer d’àudio associat.',
    };
  }
  if (note.audio_deleted_at) {
    return {
      delete: false,
      reason: 'ALREADY_DELETED',
      explanation: 'L’àudio ja s’ha esborrat.',
    };
  }

  if (!isRetentionPolicy(note.retention_policy)) {
    return {
      delete: false,
      reason: 'INVALID_POLICY',
      explanation: `Política de retenció desconeguda («${note.retention_policy}»): no s’esborra res.`,
    };
  }

  switch (note.retention_policy) {
    case 'KEEP':
      return {
        delete: false,
        reason: 'KEEP_FOREVER',
        explanation: 'La política és conservar l’àudio indefinidament.',
      };

    case 'DELETE_AFTER_TRANSCRIPTION':
      return note.transcription_status === 'FET'
        ? {
            delete: true,
            reason: 'TRANSCRIBED',
            explanation: 'La transcripció ja s’ha completat: l’àudio es pot esborrar.',
          }
        : {
            delete: false,
            reason: 'AWAITING_TRANSCRIPTION',
            explanation: 'Encara no hi ha transcripció completada; l’àudio es conserva.',
          };

    case 'DELETE_AFTER_CONFIRM':
      return note.confirmed_at
        ? {
            delete: true,
            reason: 'CONFIRMED',
            explanation: 'La proposta ja s’ha confirmat: l’àudio es pot esborrar.',
          }
        : {
            delete: false,
            reason: 'AWAITING_CONFIRMATION',
            explanation: 'La proposta encara no s’ha confirmat; l’àudio es conserva.',
          };

    case 'KEEP_DAYS': {
      const days = note.retention_days;
      if (typeof days !== 'number' || !Number.isFinite(days) || days < 0) {
        return {
          delete: false,
          reason: 'MISSING_RETENTION_DAYS',
          explanation:
            'La política és KEEP_DAYS però no s’ha indicat quants dies: no s’esborra res fins que es configuri.',
        };
      }
      const createdAt = Date.parse(note.created_at);
      if (Number.isNaN(createdAt)) {
        return {
          delete: false,
          reason: 'MISSING_RETENTION_DAYS',
          explanation: 'La data de creació de la nota no és vàlida: no s’esborra res.',
        };
      }
      const deletableAt = new Date(createdAt + days * 24 * 60 * 60 * 1000);
      return now.getTime() >= deletableAt.getTime()
        ? {
            delete: true,
            reason: 'RETENTION_WINDOW_ELAPSED',
            explanation: `Han passat ${days} dies des de la gravació: l’àudio es pot esborrar.`,
            deletableAt: deletableAt.toISOString(),
          }
        : {
            delete: false,
            reason: 'WITHIN_RETENTION_WINDOW',
            explanation: `L’àudio es conserva fins al ${deletableAt.toISOString()}.`,
            deletableAt: deletableAt.toISOString(),
          };
    }
  }
}

/** Convenience for the cleanup job: the notes whose audio is due for deletion. */
export function selectAudioForDeletion<T extends RetentionSubject>(
  notes: readonly T[],
  now: Date,
): readonly { readonly note: T; readonly decision: RetentionDecision }[] {
  return notes
    .map((note) => ({ note, decision: shouldDeleteAudio(note, now) }))
    .filter((entry) => entry.decision.delete);
}
