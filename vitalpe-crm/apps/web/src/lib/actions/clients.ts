'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { query, requireSession } from '@/lib/auth';
import { friendlyError } from '@/lib/db';

/**
 * Company server actions.
 *
 * Classification and verification go through `app.confirm_classification` and
 * `app.record_verification`: the rule that only a human confirms a
 * classification, that NO POTENCIAL demands a reason, and that a verification
 * is appended and never overwritten, all live in the database. Here we only
 * collect the input and turn a rejection into a sentence a person can read.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const CLASSIFICATIONS = [
  'ACTIU SEGUR',
  'POTENCIAL INTERESSAT',
  'POTENCIAL AMB UN ALTRE PROVEIDOR',
  'NO POTENCIAL',
];

const VERIFICATION_STATUSES = ['ACTIVA', 'INACTIVA', 'PENDENT DE VERIFICAR', 'DUBTOSA'];

/** Fields a user may edit inline or from the sectioned form. */
const EDITABLE_TEXT = new Set([
  'name',
  'legal_name',
  'tax_id',
  'municipality',
  'comarca',
  'province',
  'website',
  'general_notes',
  'external_account_code',
  'other_client_type',
  'client_type_code',
]);
const EDITABLE_BOOL = new Set(['do_cava', 'do_penedes', 'do_catalunya', 'do_altres']);

function refresh(clientId: string): void {
  revalidatePath('/clients');
  revalidatePath(`/clients/${clientId}`);
}

export async function confirmClassification(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const clientId = String(formData.get('clientId') ?? '');
  const classification = String(formData.get('classification') ?? '');
  const reason = String(formData.get('reason') ?? '').trim() || null;

  if (!clientId) return { ok: false, error: 'Falta l’empresa.' };
  if (!CLASSIFICATIONS.includes(classification)) {
    return { ok: false, error: 'Tria una classificació vàlida.' };
  }
  if (classification === 'NO POTENCIAL' && !reason) {
    return { ok: false, error: 'Cal indicar el motiu per classificar com a NO POTENCIAL.' };
  }

  try {
    await query(session, async (q) => {
      await q.run(`select app.confirm_classification($1::uuid, $2::app.classification, $3)`, [
        clientId,
        classification,
        reason,
      ]);
    });
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
  refresh(clientId);
  return { ok: true };
}

export async function recordVerification(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const clientId = String(formData.get('clientId') ?? '');
  const status = String(formData.get('status') ?? '');
  const source = String(formData.get('source') ?? '').trim();
  const note = String(formData.get('note') ?? '').trim() || null;

  if (!VERIFICATION_STATUSES.includes(status)) {
    return { ok: false, error: 'Tria un estat de verificació vàlid.' };
  }
  if (!source) return { ok: false, error: 'Cal indicar la font de la verificació.' };

  try {
    await query(session, async (q) => {
      await q.run(
        `select app.record_verification($1::uuid, $2::app.verification_status, $3, $4)`,
        [clientId, status, source, note],
      );
    });
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
  refresh(clientId);
  return { ok: true };
}

/**
 * Inline / sectioned edit of the company's own fields.
 * `camps` lists exactly which fields the form is responsible for, so an inline
 * edit of one field never blanks the rest.
 */
export async function updateClient(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const clientId = String(formData.get('clientId') ?? '');
  const fields = String(formData.get('camps') ?? '')
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);

  if (!clientId) return { ok: false, error: 'Falta l’empresa.' };
  if (fields.length === 0) return { ok: false, error: 'No hi ha res per desar.' };

  const sets: string[] = [];
  const params: unknown[] = [clientId];
  const push = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  for (const field of fields) {
    if (EDITABLE_TEXT.has(field)) {
      const raw = String(formData.get(field) ?? '').trim();
      sets.push(`${field} = ${push(raw === '' ? null : raw)}`);
    } else if (EDITABLE_BOOL.has(field)) {
      sets.push(`${field} = ${push(formData.get(field) === 'on' || formData.get(field) === '1')}`);
    }
  }
  if (sets.length === 0) return { ok: false, error: 'No hi ha res per desar.' };
  sets.push(`updated_by = ${push(session.userId)}::uuid`);

  const name = formData.get('name');
  if (fields.includes('name') && typeof name === 'string' && !name.trim()) {
    return { ok: false, error: 'El nom de l’empresa no pot quedar buit.' };
  }

  try {
    await query(session, async (q) => {
      await q.run(
        `update public.clients set ${sets.join(', ')} where id = $1::uuid and deleted_at is null`,
        params,
      );
    });
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
  refresh(clientId);
  return { ok: true };
}

/** Reassigns the company. Managers only — RLS rejects a COMERCIAL. */
export async function assignClient(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const clientId = String(formData.get('clientId') ?? '');
  const ownerId = String(formData.get('ownerId') ?? '').trim();

  try {
    await query(session, async (q) => {
      await q.run(
        `update public.clients set owner_id = nullif($2, '')::uuid, updated_by = $3::uuid
          where id = $1::uuid and deleted_at is null`,
        [clientId, ownerId, session.userId],
      );
    });
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
  refresh(clientId);
  return { ok: true };
}

/**
 * Table preferences (visible columns + density) live in a cookie so the choice
 * survives a reload without polluting the shareable filter URL.
 */
export async function saveTablePreferences(formData: FormData): Promise<ActionResult> {
  await requireSession();
  const columns = formData.getAll('columna').map(String).filter(Boolean);
  const density = String(formData.get('densitat') ?? '') === 'compacta' ? 'compacta' : 'normal';

  const store = await cookies();
  const options = {
    httpOnly: false,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    secure: process.env.NODE_ENV === 'production',
  };
  store.set('vitalpe_clients_columnes', columns.join(','), options);
  store.set('vitalpe_clients_densitat', density, options);
  revalidatePath('/clients');
  return { ok: true };
}
