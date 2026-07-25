import { NextResponse } from 'next/server';
import { sessionFromBearer } from '@/lib/auth';
import { applyProposalFor } from '@/lib/voice/pipeline';

/**
 * POST /api/veu/aplicar — writes the actions the person confirmed on the phone.
 *
 * The body carries `voiceNoteId` and `actions`: the subset of the proposal the
 * user kept, after any edits. The pipeline re-validates them against the closed
 * action list, checks the note belongs to this user, refuses a second apply,
 * and does the whole thing in one transaction — so a phone on a flaky train
 * connection cannot half-write a visit.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  const session = await sessionFromBearer(request);
  if (session === null) {
    return NextResponse.json({ ok: false, error: 'Sessió no vàlida.' }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'Cos de la petició no vàlid.' }, { status: 400 });
  }

  return NextResponse.json(await applyProposalFor(session, form));
}
