/**
 * Voice notes recorded with no signal.
 *
 * The audio file is written to the app's private directory the moment the
 * recording stops, BEFORE anything is queued, and the queue entry points at it.
 * Those two writes can be interrupted — by a force-quit, by iOS reclaiming
 * memory, by a battery death — so on every launch the two sides are reconciled:
 *
 *   a file with no queue entry   -> the app died between writing the audio and
 *                                   queueing it. Re-queue it. Never delete it.
 *   an entry with no file        -> the audio is genuinely gone. The entry is
 *                                   surfaced as an error, not silently dropped.
 *   an applied entry with a file -> uploaded and confirmed; the file may go.
 *
 * The rule the reconciliation encodes: audio is only ever deleted after the
 * server has confirmed it. Everything else errs towards keeping the file.
 *
 * Pure module: no React, no Expo, no I/O — the caller supplies the directory
 * listing and applies the returned actions.
 */

import type { SyncQueueEntry, EnqueueInput } from './syncQueue.js';
import { makeIdempotencyKey } from './syncQueue.js';

export const VOICE_DIRECTORY = 'notes-de-veu';
export const VOICE_EXTENSION = 'm4a';

/** `notes-de-veu/<uuid>.m4a` — the id is recoverable from the name. */
export function recordingFileName(recordingId: string): string {
  return `${recordingId}.${VOICE_EXTENSION}`;
}

export function recordingIdFromFileName(fileName: string): string | null {
  const suffix = `.${VOICE_EXTENSION}`;
  if (!fileName.endsWith(suffix)) return null;
  const id = fileName.slice(0, -suffix.length);
  return id.length > 0 ? id : null;
}

export function entityKeyForRecording(recordingId: string): string {
  return `nota-veu:${recordingId}`;
}

export interface RecordingFile {
  /** File name inside {@link VOICE_DIRECTORY}. */
  fileName: string;
  /** Bytes on disk; a 0-byte file is a failed recording, not a note. */
  size: number;
  modifiedAt: string;
}

export interface ReconcileResult {
  /** Orphan audio to put back on the queue. */
  toEnqueue: EnqueueInput[];
  /** Confirmed uploaded: the local audio may be removed. */
  safeToDelete: string[];
  /** Queued notes whose audio has vanished: report, do not retry forever. */
  missingAudio: SyncQueueEntry[];
  /** Empty files from an interrupted recording. */
  emptyFiles: string[];
}

export interface ReconcileOptions {
  now: Date;
  /** Injected so the result is deterministic in a test. */
  nonce: (fileName: string) => string;
}

/**
 * Brings the audio directory and the queue back into agreement.
 * Nothing here deletes anything; it returns the actions for the caller.
 */
export function reconcileRecordings(
  files: readonly RecordingFile[],
  queue: readonly SyncQueueEntry[],
  options: ReconcileOptions,
): ReconcileResult {
  const voiceEntries = queue.filter((e) => e.operation === 'CREAR_NOTA_VEU');
  const byRecording = new Map<string, SyncQueueEntry>();
  for (const entry of voiceEntries) {
    const id = typeof entry.payload.recordingId === 'string' ? entry.payload.recordingId : null;
    if (id !== null) byRecording.set(id, entry);
  }

  const toEnqueue: EnqueueInput[] = [];
  const safeToDelete: string[] = [];
  const emptyFiles: string[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const recordingId = recordingIdFromFileName(file.fileName);
    if (recordingId === null) continue;
    seen.add(recordingId);

    if (file.size <= 0) {
      emptyFiles.push(file.fileName);
      continue;
    }

    const entry = byRecording.get(recordingId);
    if (entry === undefined) {
      const entityKey = entityKeyForRecording(recordingId);
      toEnqueue.push({
        id: recordingId,
        operation: 'CREAR_NOTA_VEU',
        entityKey,
        payload: {
          recordingId,
          fileName: file.fileName,
          recordedAt: file.modifiedAt,
          recoveredAfterRestart: true,
        },
        idempotencyKey: makeIdempotencyKey(
          'CREAR_NOTA_VEU',
          entityKey,
          file.modifiedAt,
          options.nonce(file.fileName),
        ),
        baseVersion: null,
      });
      continue;
    }

    if (entry.status === 'APLICAT') safeToDelete.push(file.fileName);
  }

  const missingAudio = voiceEntries.filter((entry) => {
    if (entry.status === 'APLICAT') return false;
    const id = typeof entry.payload.recordingId === 'string' ? entry.payload.recordingId : null;
    return id === null || !seen.has(id);
  });

  return { toEnqueue, safeToDelete, missingAudio, emptyFiles };
}

/**
 * Human-readable state for the REGISTRE screen's pending list.
 * `PENDENT` deliberately reads as "safe, just waiting", because it is.
 */
export function recordingStatusLabel(entry: SyncQueueEntry): string {
  switch (entry.status) {
    case 'PENDENT':
      return entry.attempts === 0 ? 'DESADA AL MÒBIL' : `REINTENTANT (${entry.attempts})`;
    case 'APLICAT':
      return 'PUJADA';
    case 'CONFLICTE':
      return 'CONFLICTE';
    case 'ERROR':
    default:
      return 'ERROR';
  }
}
