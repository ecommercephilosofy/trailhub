'use server';

import { revalidatePath } from 'next/cache';
import { query, requireRole } from '@/lib/auth';
import { friendlyError } from '@/lib/db';

/**
 * Prospect review.
 *
 * A prospect is a company somebody found — in a DO register, a fair listing, a
 * public directory — and nothing more. It has a source and no history. These
 * two actions are the only ways one leaves the queue, and both need a person:
 * nothing here runs on a schedule, and no automated pass may call them.
 *
 * Converting creates a real company with `POTENCIAL INTERESSAT` unset — an
 * unqualified lead is exactly a company nobody has classified yet, and writing
 * a classification for it would be inventing a human judgement.
 */

export interface ProspectResult {
  ok: boolean;
  error?: string;
  clientId?: string;
}

export async function convertProspect(formData: FormData): Promise<ProspectResult> {
  const session = await requireRole('ADMIN');
  const prospectId = String(formData.get('prospectId') ?? '');
  const note = String(formData.get('note') ?? '').trim() || null;

  try {
    const clientId = await query(session, async (q) => {
      const prospect = await q.one<{
        id: string; name: string; municipality: string | null; province: string | null;
        website: string | null; phone: string | null; email: string | null;
        source: string | null; source_url: string | null; suggested_product: string | null;
        rationale: string | null; status: string;
      }>(
        `select id, name, municipality, province, website, phone, email,
                source, source_url, suggested_product, rationale, status::text as status
           from public.prospects where id = $1 and workspace_id = $2`,
        [prospectId, session.workspaceId],
      );
      if (!prospect) throw new Error('PROSPECTE_NO_TROBAT');
      if (prospect.status !== 'CANDIDAT') throw new Error('PROSPECTE_JA_DECIDIT');

      // A company with this name may already exist — the discovery pass checks,
      // but the list moves. Refuse rather than create a duplicate.
      const clash = await q.one<{ id: string }>(
        `select id from public.clients
          where workspace_id = $1 and deleted_at is null
            and name_norm = app.normalize_company($2) limit 1`,
        [session.workspaceId, prospect.name],
      );
      if (clash) throw new Error('JA_EXISTEIX_AL_CRM');

      const created = await q.one<{ id: string }>(
        `insert into public.clients
           (workspace_id, name, municipality, province, website, owner_id, in_working_list,
            general_notes)
         values ($1,$2,$3,$4,$5,$6,true,$7)
         returning id`,
        [
          session.workspaceId, prospect.name, prospect.municipality, prospect.province,
          prospect.website, session.userId,
          [
            `Alta des de PROSPECCIÓ el ${new Date().toLocaleDateString('ca-ES')}.`,
            prospect.source ? `Font: ${prospect.source}.` : null,
            prospect.source_url ? `URL: ${prospect.source_url}` : null,
            prospect.rationale ? `Motiu: ${prospect.rationale}` : null,
            prospect.suggested_product ? `Producte suggerit: ${prospect.suggested_product}` : null,
            note ? `Nota de revisió: ${note}` : null,
          ].filter(Boolean).join('\n'),
        ],
      );
      if (!created) throw new Error('NO_S_HA_POGUT_CREAR');

      if (prospect.phone || prospect.email) {
        await q.run(
          `insert into public.contacts
             (workspace_id, client_id, role_title, phone_original, email_original, is_primary, source)
           values ($1,$2,'CONTACTE GENERAL',$3,$4,true,'PROSPECCIÓ')`,
          [session.workspaceId, created.id, prospect.phone, prospect.email],
        );
      }

      await q.run(
        `update public.prospects
            set status = 'CONVERTIT', client_id = $2, reviewed_by = $3,
                reviewed_at = now(), review_note = $4
          where id = $1`,
        [prospectId, created.id, session.userId, note],
      );
      return created.id;
    }, 'CRM');

    revalidatePath('/prospeccio');
    revalidatePath('/clients', 'layout');
    return { ok: true, clientId };
  } catch (error) {
    const message = (error as Error).message;
    if (message.includes('JA_EXISTEIX_AL_CRM')) {
      return { ok: false, error: 'Aquesta empresa ja és al CRM. Descarta el prospecte.' };
    }
    if (message.includes('PROSPECTE_JA_DECIDIT')) {
      return { ok: false, error: 'Aquest prospecte ja estava decidit.' };
    }
    if (message.includes('PROSPECTE_NO_TROBAT')) {
      return { ok: false, error: 'El prospecte no existeix.' };
    }
    return { ok: false, error: friendlyError(error) };
  }
}

export async function discardProspect(formData: FormData): Promise<ProspectResult> {
  const session = await requireRole('ADMIN');
  const prospectId = String(formData.get('prospectId') ?? '');
  const note = String(formData.get('note') ?? '').trim() || null;

  try {
    await query(session, async (q) => {
      // Discarding keeps the row: the point of remembering a rejection is that
      // the next discovery pass does not put it back in front of you.
      const updated = await q.one<{ id: string }>(
        `update public.prospects
            set status = 'DESCARTAT', reviewed_by = $2, reviewed_at = now(), review_note = $3
          where id = $1 and status = 'CANDIDAT'
          returning id`,
        [prospectId, session.userId, note],
      );
      if (!updated) throw new Error('PROSPECTE_JA_DECIDIT');
    }, 'CRM');
    revalidatePath('/prospeccio');
    return { ok: true };
  } catch (error) {
    if ((error as Error).message.includes('PROSPECTE_JA_DECIDIT')) {
      return { ok: false, error: 'Aquest prospecte ja estava decidit.' };
    }
    return { ok: false, error: friendlyError(error) };
  }
}
