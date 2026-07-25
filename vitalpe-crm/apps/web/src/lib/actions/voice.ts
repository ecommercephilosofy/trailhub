'use server';

import { randomUUID } from 'node:crypto';
import { requireSession } from '@/lib/auth';
import {
  applyProposalFor,
  discardProposalFor,
  interpretAudioFor,
  interpretTextFor,
  type ApplyResult,
  type ProposalResult,
} from '@/lib/voice/pipeline';

/**
 * Voice notes and quick capture — the browser's entry points.
 *
 * Everything here is a thin wrapper: resolve the session from the cookie, then
 * hand off to `lib/voice/pipeline.ts`. The wrappers exist precisely so the
 * session-taking functions are NOT exported from a `'use server'` file, where
 * every export is callable by a browser and the session argument would be
 * attacker-controlled.
 *
 * The safety property of the pipeline is unchanged: `interpret*` only ever
 * PRODUCES a proposal, and `applyProposal` only ever consumes actions a person
 * explicitly kept.
 */

export type { ApplyResult, ProposalResult };

/** REGISTRE RÀPID: free text or a pasted transcript. */
export async function interpretText(formData: FormData): Promise<ProposalResult> {
  return interpretTextFor(await requireSession(), formData);
}

/** Uploads the recording, transcribes it, then proposes. */
export async function interpretAudio(formData: FormData): Promise<ProposalResult> {
  return interpretAudioFor(await requireSession(), formData);
}

/** Applies exactly the actions the user kept, in one transaction. */
export async function applyProposal(formData: FormData): Promise<ApplyResult> {
  return applyProposalFor(await requireSession(), formData);
}

export async function discardProposal(formData: FormData): Promise<{ ok: boolean }> {
  return discardProposalFor(await requireSession(), formData);
}

/** Used by the mobile app and the offline queue. */
export async function newIdempotencyKey(): Promise<string> {
  return randomUUID();
}
