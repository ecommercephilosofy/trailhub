import { describe, expect, it } from 'vitest';
import {
  RETENTION_POLICIES,
  isRetentionPolicy,
  selectAudioForDeletion,
  shouldDeleteAudio,
  type RetentionSubject,
} from './retention';

const NOW = new Date('2026-07-23T09:00:00.000Z');

const note = (overrides: Partial<RetentionSubject> = {}): RetentionSubject => ({
  retention_policy: 'DELETE_AFTER_CONFIRM',
  audio_path: 'workspace/ws-1/voice/abc.m4a',
  created_at: '2026-07-01T09:00:00.000Z',
  transcription_status: 'PENDENT',
  ...overrides,
});

describe('shouldDeleteAudio', () => {
  it('covers every policy in the database check constraint', () => {
    expect([...RETENTION_POLICIES]).toEqual([
      'KEEP',
      'DELETE_AFTER_TRANSCRIPTION',
      'DELETE_AFTER_CONFIRM',
      'KEEP_DAYS',
    ]);
    for (const policy of RETENTION_POLICIES) {
      expect(isRetentionPolicy(policy)).toBe(true);
      expect(() => shouldDeleteAudio(note({ retention_policy: policy }), NOW)).not.toThrow();
    }
  });

  it('never deletes when there is nothing to delete', () => {
    expect(shouldDeleteAudio(note({ audio_path: null }), NOW)).toMatchObject({
      delete: false,
      reason: 'NO_AUDIO',
    });
    expect(shouldDeleteAudio(note({ audio_path: '  ' }), NOW).delete).toBe(false);
    expect(
      shouldDeleteAudio(note({ audio_deleted_at: '2026-07-02T00:00:00.000Z' }), NOW),
    ).toMatchObject({ delete: false, reason: 'ALREADY_DELETED' });
  });

  it('KEEP keeps the audio forever', () => {
    expect(
      shouldDeleteAudio(
        note({ retention_policy: 'KEEP', transcription_status: 'FET', confirmed_at: '2026-07-02T00:00:00Z' }),
        NOW,
      ),
    ).toMatchObject({ delete: false, reason: 'KEEP_FOREVER' });
  });

  it('DELETE_AFTER_TRANSCRIPTION waits for a completed transcription', () => {
    const policy = 'DELETE_AFTER_TRANSCRIPTION';
    for (const status of ['PENDENT', 'EN PROCES', 'ERROR', 'NO DISPONIBLE']) {
      expect(
        shouldDeleteAudio(note({ retention_policy: policy, transcription_status: status }), NOW),
      ).toMatchObject({ delete: false, reason: 'AWAITING_TRANSCRIPTION' });
    }
    expect(
      shouldDeleteAudio(note({ retention_policy: policy, transcription_status: 'FET' }), NOW),
    ).toMatchObject({ delete: true, reason: 'TRANSCRIBED' });
  });

  it('DELETE_AFTER_CONFIRM waits for the human confirmation', () => {
    expect(shouldDeleteAudio(note({ transcription_status: 'FET' }), NOW)).toMatchObject({
      delete: false,
      reason: 'AWAITING_CONFIRMATION',
    });
    expect(
      shouldDeleteAudio(note({ confirmed_at: '2026-07-22T10:00:00.000Z' }), NOW),
    ).toMatchObject({ delete: true, reason: 'CONFIRMED' });
  });

  it('KEEP_DAYS counts from the recording date', () => {
    const base = { retention_policy: 'KEEP_DAYS', created_at: '2026-07-20T09:00:00.000Z' };

    const within = shouldDeleteAudio(note({ ...base, retention_days: 30 }), NOW);
    expect(within).toMatchObject({ delete: false, reason: 'WITHIN_RETENTION_WINDOW' });
    expect(within.deletableAt).toBe('2026-08-19T09:00:00.000Z');

    expect(shouldDeleteAudio(note({ ...base, retention_days: 3 }), NOW)).toMatchObject({
      delete: true,
      reason: 'RETENTION_WINDOW_ELAPSED',
    });
    // Exactly on the boundary the audio is deletable.
    expect(
      shouldDeleteAudio(
        note({ retention_policy: 'KEEP_DAYS', retention_days: 1, created_at: '2026-07-22T09:00:00.000Z' }),
        NOW,
      ).delete,
    ).toBe(true);
    expect(
      shouldDeleteAudio(
        note({ retention_policy: 'KEEP_DAYS', retention_days: 0, created_at: '2026-07-23T09:00:00.000Z' }),
        NOW,
      ).delete,
    ).toBe(true);
  });

  it('refuses to delete on bad data rather than guessing', () => {
    expect(
      shouldDeleteAudio(note({ retention_policy: 'KEEP_DAYS', retention_days: null }), NOW),
    ).toMatchObject({ delete: false, reason: 'MISSING_RETENTION_DAYS' });
    expect(
      shouldDeleteAudio(note({ retention_policy: 'KEEP_DAYS', retention_days: -5 }), NOW).delete,
    ).toBe(false);
    expect(
      shouldDeleteAudio(
        note({ retention_policy: 'KEEP_DAYS', retention_days: 1, created_at: 'no-és-una-data' }),
        NOW,
      ).delete,
    ).toBe(false);
    expect(shouldDeleteAudio(note({ retention_policy: 'ESBORRA-HO TOT' }), NOW)).toMatchObject({
      delete: false,
      reason: 'INVALID_POLICY',
    });
  });

  it('always explains itself in Catalan', () => {
    for (const policy of RETENTION_POLICIES) {
      const decision = shouldDeleteAudio(note({ retention_policy: policy, retention_days: 10 }), NOW);
      expect(decision.explanation.length).toBeGreaterThan(10);
    }
  });
});

describe('selectAudioForDeletion', () => {
  it('returns only the notes that are due', () => {
    const due = selectAudioForDeletion(
      [
        note({ retention_policy: 'KEEP' }),
        note({ confirmed_at: '2026-07-22T10:00:00.000Z' }),
        note({ retention_policy: 'DELETE_AFTER_TRANSCRIPTION', transcription_status: 'FET' }),
        note({ retention_policy: 'KEEP_DAYS', retention_days: 365 }),
      ],
      NOW,
    );
    expect(due).toHaveLength(2);
    expect(due.every((entry) => entry.decision.delete)).toBe(true);
  });
});
