import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { describe, reconcileUser } from '../sync-engine';

/**
 * Manual / scheduled reconciliation.
 *
 * This is the safety net for everything push notifications can miss: a lapsed
 * watch channel, a notification that never arrived, a transient 5xx on a push.
 * It renews the channels, replays any pending local notification through the
 * real webhook path, pulls with the stored sync token (falling back to a full
 * resync when Google says the token has aged out) and finally retries every
 * link left in PENDENT or ERROR.
 *
 * Every step is idempotent, so a cron may hit it as often as it likes.
 */
export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Cal iniciar sessió.' }, { status: 401 });
  }
  try {
    const report = await reconcileUser(session.userId, session.workspaceId);
    return NextResponse.json({
      enviades: report.pushed.map((r) => ({
        visita: r.visitId,
        resultat: r.outcome,
        detall: r.message,
      })),
      rebudes: {
        examinats: report.pull?.examined ?? 0,
        aplicats: report.pull?.applied ?? 0,
        ignorats_sense_identitat_crm: report.pull?.ignored ?? 0,
        resincronitzacio_completa: report.pull?.fullResync ?? false,
        error: report.pull?.error ?? null,
      },
      canals: report.channels,
      avisos_locals_processats: report.localNotifications,
    });
  } catch (error) {
    return NextResponse.json({ error: describe(error) }, { status: 500 });
  }
}

export async function GET(): Promise<Response> {
  return POST();
}
