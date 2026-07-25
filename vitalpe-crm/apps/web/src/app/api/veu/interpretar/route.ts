import { NextResponse } from 'next/server';
import { sessionFromBearer } from '@/lib/auth';
import { interpretAudioFor, interpretTextFor } from '@/lib/voice/pipeline';

/**
 * POST /api/veu/interpretar — the phone's entry to the voice pipeline.
 *
 * The mobile app cannot call a server action (those are a browser/RSC protocol),
 * so it posts multipart form data with a Supabase bearer token. The session is
 * resolved from that token and the SAME pipeline runs as on the web: this
 * endpoint only ever returns a PROPOSAL. Nothing reaches the CRM here.
 *
 * Send either `audio` (a file) or `text`; `clientId` is optional and, when
 * present, pins every proposed action to that company.
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

  const result =
    form.get('audio') instanceof File
      ? await interpretAudioFor(session, form)
      : await interpretTextFor(session, form);

  // A refused interpretation is a 200 with ok:false: the client shows the
  // message and keeps the recording. Only auth and malformed input are HTTP
  // errors, because only those mean "do not bother retrying as-is".
  return NextResponse.json(result);
}
