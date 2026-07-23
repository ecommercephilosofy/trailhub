'use server';

import { revalidatePath } from 'next/cache';
import { query, requireSession } from '@/lib/auth';
import { friendlyError } from '@/lib/db';

/**
 * Contact server actions.
 *
 * "Only one active primary contact per company" is a partial unique index
 * (`contacts_single_primary_uq`), not a rule re-implemented here: we demote the
 * previous primary inside the same transaction and let the index be the judge.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const CONTACT_TYPES = ['GENERAL', 'DIRECTE'];

interface ContactInput {
  firstName: string;
  lastName: string;
  roleTitle: string;
  phone: string;
  email: string;
  contactType: string;
  notes: string;
  isPrimary: boolean;
  isActive: boolean;
}

function read(formData: FormData): ContactInput {
  const text = (key: string): string => String(formData.get(key) ?? '').trim();
  return {
    firstName: text('firstName'),
    lastName: text('lastName'),
    roleTitle: text('roleTitle'),
    phone: text('phone'),
    email: text('email'),
    contactType: CONTACT_TYPES.includes(text('contactType')) ? text('contactType') : 'GENERAL',
    notes: text('notes'),
    isPrimary: formData.get('isPrimary') === 'on' || formData.get('isPrimary') === '1',
    isActive: formData.get('isActive') !== 'off' && formData.get('isActive') !== '0',
  };
}

function validate(input: ContactInput): string | null {
  if (!input.firstName && !input.lastName && !input.email && !input.phone) {
    return 'Un contacte necessita com a mínim un nom, un telèfon o un correu.';
  }
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
    return 'El correu no té un format vàlid.';
  }
  return null;
}

export async function createContact(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const clientId = String(formData.get('clientId') ?? '');
  const input = read(formData);
  const problem = validate(input);
  if (problem) return { ok: false, error: problem };

  try {
    await query(session, async (q) => {
      if (input.isPrimary) {
        await q.run(
          `update public.contacts set is_primary = false
            where client_id = $1::uuid and is_primary and deleted_at is null`,
          [clientId],
        );
      }
      await q.run(
        `insert into public.contacts
           (workspace_id, client_id, first_name, last_name, role_title, phone_original,
            email_original, contact_type, is_primary, is_active, notes, source)
         values ($1::uuid, $2::uuid, nullif($3,''), nullif($4,''), nullif($5,''), nullif($6,''),
                 nullif($7,''), $8::app.contact_type, $9, $10, nullif($11,''), 'CRM')`,
        [
          session.workspaceId, clientId, input.firstName, input.lastName, input.roleTitle,
          input.phone, input.email, input.contactType, input.isPrimary, input.isActive, input.notes,
        ],
      );
    });
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
  revalidatePath(`/clients/${clientId}`);
  revalidatePath('/clients');
  return { ok: true };
}

export async function updateContact(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const clientId = String(formData.get('clientId') ?? '');
  const contactId = String(formData.get('contactId') ?? '');
  const input = read(formData);
  const problem = validate(input);
  if (problem) return { ok: false, error: problem };

  try {
    await query(session, async (q) => {
      if (input.isPrimary) {
        await q.run(
          `update public.contacts set is_primary = false
            where client_id = $1::uuid and id <> $2::uuid and is_primary and deleted_at is null`,
          [clientId, contactId],
        );
      }
      await q.run(
        `update public.contacts
            set first_name = nullif($3,''), last_name = nullif($4,''), role_title = nullif($5,''),
                phone_original = nullif($6,''), email_original = nullif($7,''),
                contact_type = $8::app.contact_type, is_primary = $9, is_active = $10,
                notes = nullif($11,'')
          where id = $2::uuid and client_id = $1::uuid and deleted_at is null`,
        [
          clientId, contactId, input.firstName, input.lastName, input.roleTitle,
          input.phone, input.email, input.contactType, input.isPrimary, input.isActive, input.notes,
        ],
      );
    });
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
  revalidatePath(`/clients/${clientId}`);
  revalidatePath('/clients');
  return { ok: true };
}

/** Promotes one contact to primary, demoting whoever held the flag. */
export async function setPrimaryContact(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const clientId = String(formData.get('clientId') ?? '');
  const contactId = String(formData.get('contactId') ?? '');

  try {
    await query(session, async (q) => {
      await q.run(
        `update public.contacts set is_primary = false
          where client_id = $1::uuid and id <> $2::uuid and is_primary and deleted_at is null`,
        [clientId, contactId],
      );
      await q.run(
        `update public.contacts set is_primary = true, is_active = true
          where id = $2::uuid and client_id = $1::uuid and deleted_at is null`,
        [clientId, contactId],
      );
    });
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
  revalidatePath(`/clients/${clientId}`);
  revalidatePath('/clients');
  return { ok: true };
}

/**
 * Contacts are never removed — they are deactivated, so the history that points
 * at them keeps making sense.
 */
export async function deactivateContact(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const clientId = String(formData.get('clientId') ?? '');
  const contactId = String(formData.get('contactId') ?? '');
  const active = formData.get('reactivar') === '1';

  try {
    await query(session, async (q) => {
      await q.run(
        `update public.contacts
            set is_active = $3, is_primary = case when $3 then is_primary else false end
          where id = $2::uuid and client_id = $1::uuid and deleted_at is null`,
        [clientId, contactId, active],
      );
    });
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
  revalidatePath(`/clients/${clientId}`);
  revalidatePath('/clients');
  return { ok: true };
}
