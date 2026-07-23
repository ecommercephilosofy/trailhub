import { NextResponse } from 'next/server';
import { processNotification } from '../sync-engine';

/**
 * Google Calendar push-notification receiver.
 *
 * The request body is empty by design: a notification says only *that* a
 * calendar changed. Everything that matters is in the headers, so this handler
 * does four things and nothing else:
 *
 *  1. validates `X-Goog-Channel-Token` in constant time against the token we
 *     chose when the channel was opened (and rejects an unknown channel id);
 *  2. records `(channelId, messageNumber)` — the unique index on
 *     `calendar_sync_events` makes a replay a no-op;
 *  3. runs an incremental sync with the stored sync token, finding each visit
 *     through the event's private extended properties, never its title;
 *  4. answers 200 quickly. Google retries on anything else, so an internal
 *     failure answers 202 to acknowledge receipt while the error is recorded.
 *
 * It never writes back to Google. See `sync-engine.ts` → `applyRemoteEvent`.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const result = await processNotification(request.headers);
  return NextResponse.json(
    { resultat: result.outcome },
    { status: result.status === 401 || result.status === 404 ? result.status : 200 },
  );
}

/** A GET is only ever a human checking the endpoint is alive. */
export async function GET(): Promise<Response> {
  return NextResponse.json({
    endpoint: 'google-calendar-webhook',
    metode: 'POST',
    nota: 'Els avisos de Google arriben per POST amb capçaleres X-Goog-*.',
  });
}
