'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/auth';
import {
  createDedicatedCalendar,
  disconnect,
  ensureConnection,
  openWatchChannel,
  reconcileUser,
  setCalendar,
  describe,
} from '@/app/api/google/sync-engine';

/**
 * Calendar-connection actions used by the settings panel at
 * `/calendari/google`.
 *
 * Nothing here ever returns a token, an authorisation code or an encrypted
 * value: the panel only ever sees an account e-mail, a calendar name, a status
 * and the last error message.
 */

export interface CalendarActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

function refresh(): void {
  revalidatePath('/calendari');
  revalidatePath('/calendari/google');
  revalidatePath('/inici');
}

/** Picks an existing calendar as the destination for CRM visits. */
export async function chooseCalendar(formData: FormData): Promise<CalendarActionResult> {
  const session = await requireSession();
  const calendarId = String(formData.get('calendarId') ?? '').trim();
  const calendarName = String(formData.get('calendarName') ?? '').trim() || calendarId;
  if (!calendarId) return { ok: false, error: 'Cal triar un calendari.' };
  try {
    const connection = await ensureConnection(session.userId, session.workspaceId);
    await setCalendar(connection.id, calendarId, calendarName);
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
  refresh();
  return { ok: true, message: `Calendari «${calendarName}» seleccionat.` };
}

/** Creates the dedicated `VITALPE — VISITES COMERCIALS` calendar and uses it. */
export async function createCalendar(): Promise<CalendarActionResult> {
  const session = await requireSession();
  try {
    const connection = await ensureConnection(session.userId, session.workspaceId);
    const id = await createDedicatedCalendar(connection.id);
    if (!id) return { ok: false, error: 'No s’ha pogut crear el calendari.' };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
  refresh();
  return { ok: true, message: 'Calendari dedicat creat i seleccionat.' };
}

/**
 * Forces a full reconciliation: renews watch channels, replays notifications,
 * pulls remote changes and pushes everything still pending. Idempotent.
 */
export async function forceReconciliation(): Promise<CalendarActionResult> {
  const session = await requireSession();
  try {
    const report = await reconcileUser(session.userId, session.workspaceId);
    const pushed = report.pushed.filter((r) => r.outcome !== 'SENSE CANVIS').length;
    refresh();
    return {
      ok: true,
      message:
        `Reconciliació completada · ${pushed} visites enviades, ` +
        `${report.pull?.applied ?? 0} canvis aplicats des del calendari, ` +
        `${report.pull?.ignored ?? 0} esdeveniments aliens ignorats, ` +
        `${report.channels.renewed + report.channels.expired} canals renovats.`,
    };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

/** Reopens the push-notification channel without touching anything else. */
export async function renewChannel(): Promise<CalendarActionResult> {
  const session = await requireSession();
  try {
    const connection = await ensureConnection(session.userId, session.workspaceId);
    const channelId = await openWatchChannel(connection.id);
    refresh();
    return channelId
      ? { ok: true, message: 'Canal d’avisos obert.' }
      : { ok: false, error: 'No s’ha pogut obrir el canal d’avisos.' };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

/**
 * Disconnects the account: closes the channels, forgets the tokens and the sync
 * cursor. The CRM visits and their history are untouched.
 */
export async function disconnectCalendar(): Promise<CalendarActionResult> {
  const session = await requireSession();
  try {
    const connection = await ensureConnection(session.userId, session.workspaceId);
    await disconnect(connection.id);
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
  refresh();
  return { ok: true, message: 'Compte desconnectat. Les visites del CRM es mantenen.' };
}

/** Provisions the local calendar connection so the feature works with no Google. */
export async function connectLocalCalendar(): Promise<CalendarActionResult> {
  const session = await requireSession();
  try {
    const connection = await ensureConnection(session.userId, session.workspaceId);
    await openWatchChannel(connection.id);
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
  refresh();
  return { ok: true, message: 'Calendari local connectat.' };
}
