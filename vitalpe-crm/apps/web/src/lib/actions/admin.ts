'use server';

import { revalidatePath } from 'next/cache';
import { query, requireSession } from '@/lib/auth';
import { friendlyError } from '@/lib/db';
import { elevated, field, ONLY_ADMIN, type ActionResult } from '@/components/admin/service';
import { isByProduct } from '../../../../../scripts/import/products';
import { isBagInBox } from '../../../../../scripts/import/sources';

/**
 * Catalogue, unmapped values, duplicate queue and merge journal.
 *
 * The catalogue and the merge function are not writable by `authenticated`
 * (see components/admin/service.ts), so those actions take the elevated path
 * behind an explicit ADMIN check. Recording a duplicate *decision* does not:
 * `duplicate_candidates_decide` is an ADMIN policy, so it runs as the user and
 * the database is the one saying no to everybody else.
 */

const CATEGORIES = ['BASE CAVA', 'DO PENEDES', 'DO CATALUNYA', 'ALTRES / SENSE DO'] as const;

const DECISIONS = [
  'CREAR COM A NOVA',
  'ACTUALITZAR EXISTENT',
  'IGNORAR',
  'FUSIONAR',
  'MANTENIR SEPARADES',
] as const;

/** Descriptive fields copied into the survivor. Never a unique key, never overwrite. */
const ENRICH_FIELDS = [
  'legal_name',
  'municipality',
  'comarca',
  'province',
  'website',
  'external_account_code',
  'other_client_type',
] as const;

function outOfScope(name: string): string | null {
  if (isBagInBox(name)) {
    return 'Bag in Box no forma part del catàleg de vi a granel: és un mòdul futur i les seves línies es conserven a REGISTRES EXCLOSOS.';
  }
  if (isByProduct(name)) {
    return 'BRISA i MARES són subproductes, no vi a granel. El brief els deixa fora del catàleg i les seves línies es conserven a REGISTRES EXCLOSOS.';
  }
  return null;
}

function adminError(error: unknown): string {
  if (error instanceof Error && error.message === ONLY_ADMIN) {
    return 'Només un ADMIN pot fer aquesta acció.';
  }
  return friendlyError(error);
}

// ---------------------------------------------------------------------------
// Product catalogue
// ---------------------------------------------------------------------------

export async function createProduct(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const name = field(formData, 'name');
  const category = field(formData, 'category');
  const organic = formData.get('organic') === 'on' || formData.get('organic') === 'true';
  if (!name) return { ok: false, error: 'Cal un nom de producte.' };
  if (!category || !(CATEGORIES as readonly string[]).includes(category)) {
    return { ok: false, error: 'Cal una categoria del catàleg.' };
  }
  const blocked = outOfScope(name);
  if (blocked) return { ok: false, error: blocked };

  try {
    await elevated(session, 'CRM', async (q) => {
      const next = await q.one<{ n: number }>(
        `select coalesce(max(sort_order), 0) + 1 as n from public.products where category = $1`,
        [category],
      );
      await q.run(
        `insert into public.products (name, category, is_organic, sort_order) values ($1, $2, $3, $4)`,
        [name, category, organic, next?.n ?? 100],
      );
    });
  } catch (error) {
    return { ok: false, error: adminError(error) };
  }
  revalidatePath('/administracio/productes');
  return { ok: true };
}

export async function setProductActive(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const id = field(formData, 'id');
  const active = field(formData, 'active') === 'true';
  if (!id) return { ok: false, error: 'Falta el producte.' };
  try {
    await elevated(session, 'CRM', (q) =>
      q.run(`update public.products set is_active = $2 where id = $1 and deleted_at is null`, [
        id,
        active,
      ]),
    );
  } catch (error) {
    return { ok: false, error: adminError(error) };
  }
  revalidatePath('/administracio/productes');
  return { ok: true };
}

/** Swaps `sort_order` with the neighbour inside the same category. */
export async function moveProduct(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const id = field(formData, 'id');
  const direction = field(formData, 'direction');
  if (!id || (direction !== 'AMUNT' && direction !== 'AVALL')) {
    return { ok: false, error: 'Dades incompletes.' };
  }
  try {
    await elevated(session, 'CRM', async (q) => {
      const current = await q.one<{ category: string; sort_order: number }>(
        `select category, sort_order from public.products where id = $1 and deleted_at is null`,
        [id],
      );
      if (!current) throw new Error('PRODUCTE_NO_TROBAT');
      const neighbour = await q.one<{ id: string; sort_order: number }>(
        direction === 'AMUNT'
          ? `select id, sort_order from public.products
              where category = $1 and deleted_at is null and sort_order < $2
              order by sort_order desc limit 1`
          : `select id, sort_order from public.products
              where category = $1 and deleted_at is null and sort_order > $2
              order by sort_order asc limit 1`,
        [current.category, current.sort_order],
      );
      if (!neighbour) return;
      await q.run(`update public.products set sort_order = $2 where id = $1`, [id, neighbour.sort_order]);
      await q.run(`update public.products set sort_order = $2 where id = $1`, [
        neighbour.id,
        current.sort_order,
      ]);
    });
  } catch (error) {
    return { ok: false, error: adminError(error) };
  }
  revalidatePath('/administracio/productes');
  return { ok: true };
}

export async function addProductAlias(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const productId = field(formData, 'productId');
  const alias = field(formData, 'alias');
  if (!productId || !alias) return { ok: false, error: 'Cal el producte i el text de l’àlies.' };
  const blocked = outOfScope(alias);
  if (blocked) return { ok: false, error: blocked };

  try {
    await elevated(session, 'CRM', (q) =>
      q.run(
        `insert into public.product_aliases (product_id, alias, source)
         values ($1, $2, 'ADMINISTRACIO')
         on conflict (alias_norm) do nothing`,
        [productId, alias],
      ),
    );
  } catch (error) {
    return { ok: false, error: adminError(error) };
  }
  revalidatePath('/administracio/productes');
  return { ok: true };
}

export async function removeProductAlias(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const id = field(formData, 'id');
  if (!id) return { ok: false, error: 'Falta l’àlies.' };
  try {
    await elevated(session, 'CRM', (q) =>
      q.run(`delete from public.product_aliases where id = $1`, [id]),
    );
  } catch (error) {
    return { ok: false, error: adminError(error) };
  }
  revalidatePath('/administracio/productes');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Unmapped values
// ---------------------------------------------------------------------------

/**
 * Resolves an unmapped PRODUCTE onto a catalogue product by creating the alias
 * the importer will match next time, and marking the value resolved.
 */
export async function mapUnmappedProduct(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const id = field(formData, 'id');
  const productId = field(formData, 'productId');
  if (!id || !productId) return { ok: false, error: 'Cal triar un producte del catàleg.' };

  try {
    await elevated(session, 'CRM', async (q) => {
      const value = await q.one<{ raw_value: string; kind: string }>(
        `select raw_value, kind from public.unmapped_values where id = $1 and workspace_id = $2`,
        [id, session.workspaceId],
      );
      if (!value) throw new Error('VALOR_NO_TROBAT');
      if (value.kind !== 'PRODUCTE') throw new Error('NO_ES_PRODUCTE');
      const blocked = outOfScope(value.raw_value);
      if (blocked) throw new Error(`FORA_CATALEG:${blocked}`);

      const product = await q.one<{ name: string }>(
        `select name from public.products where id = $1 and deleted_at is null`,
        [productId],
      );
      if (!product) throw new Error('PRODUCTE_NO_TROBAT');

      await q.run(
        `insert into public.product_aliases (product_id, alias, source)
         values ($1, $2, 'ADMINISTRACIO')
         on conflict (alias_norm) do nothing`,
        [productId, value.raw_value],
      );
      await q.run(
        `update public.unmapped_values
            set resolved_to = $2, resolved_at = now(), resolved_by = $3
          where id = $1`,
        [id, product.name, session.userId],
      );
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('FORA_CATALEG:')) {
      return { ok: false, error: error.message.slice('FORA_CATALEG:'.length) };
    }
    if (error instanceof Error && error.message === 'NO_ES_PRODUCTE') {
      return { ok: false, error: 'Aquest valor no és un producte.' };
    }
    return { ok: false, error: adminError(error) };
  }
  revalidatePath('/administracio/productes');
  return { ok: true };
}

/** Marks a value as deliberately out of scope, without inventing a product. */
export async function dismissUnmappedValue(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const id = field(formData, 'id');
  const note = field(formData, 'note');
  if (!id) return { ok: false, error: 'Falta el valor.' };
  if (session.role !== 'ADMIN') return { ok: false, error: 'Només un ADMIN pot fer aquesta acció.' };
  try {
    await query(session, (q) =>
      q.run(
        `update public.unmapped_values
            set resolved_to = $3, resolved_at = now(), resolved_by = $2
          where id = $1 and workspace_id = $4`,
        [id, session.userId, note ?? 'FORA D’ABAST', session.workspaceId],
      ),
    );
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
  revalidatePath('/administracio/productes');
  return { ok: true };
}

export async function reopenUnmappedValue(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const id = field(formData, 'id');
  if (!id) return { ok: false, error: 'Falta el valor.' };
  if (session.role !== 'ADMIN') return { ok: false, error: 'Només un ADMIN pot fer aquesta acció.' };
  try {
    await query(session, (q) =>
      q.run(
        `update public.unmapped_values
            set resolved_to = null, resolved_at = null, resolved_by = null
          where id = $1 and workspace_id = $2`,
        [id, session.workspaceId],
      ),
    );
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
  revalidatePath('/administracio/productes');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Duplicate queue
// ---------------------------------------------------------------------------

export async function decideDuplicate(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const id = field(formData, 'id');
  const decision = field(formData, 'decision');
  const note = field(formData, 'note');
  const survivor = field(formData, 'survivor') ?? 'ESQUERRA';
  const confirmation = field(formData, 'confirmation');

  if (!id || !decision || !(DECISIONS as readonly string[]).includes(decision)) {
    return { ok: false, error: 'Cal triar una decisió.' };
  }
  if (session.role !== 'ADMIN') {
    return {
      ok: false,
      error: 'Només un ADMIN pot decidir sobre duplicats. Un GERENT pot consultar la cua.',
    };
  }

  const merges = decision === 'FUSIONAR' || decision === 'ACTUALITZAR EXISTENT';
  if (merges && confirmation !== 'CONFIRMO') {
    return { ok: false, error: 'Cal confirmar explícitament la fusió.' };
  }

  const record = `update public.duplicate_candidates
            set decision = $2::app.dedupe_decision, decided_by = $3, decided_at = now(), decision_note = $4
          where id = $1 and workspace_id = $5 and decision = 'PENDENT'
          returning id`;

  try {
    if (!merges) {
      const done = await query(session, (q) =>
        q.one<{ id: string }>(record, [id, decision, session.userId, note, session.workspaceId]),
      );
      if (!done) return { ok: false, error: 'Aquest candidat ja té una decisió.' };
    } else {
      // Merge and decision land in one transaction: a half-applied merge would
      // leave the queue claiming something the data does not show.
      await elevated(session, 'CRM', async (q) => {
        const row = await q.one<{
          left_client_id: string | null;
          right_client_id: string | null;
          signals: unknown;
        }>(
          `select left_client_id, right_client_id, signals from public.duplicate_candidates
            where id = $1 and workspace_id = $2 and decision = 'PENDENT'`,
          [id, session.workspaceId],
        );
        if (!row) throw new Error('CANDIDAT_JA_DECIDIT');
        if (!row.left_client_id || !row.right_client_id) throw new Error('EMPRESA_NO_TROBADA');
        const surviving = survivor === 'DRETA' ? row.right_client_id : row.left_client_id;
        const merged = survivor === 'DRETA' ? row.left_client_id : row.right_client_id;

        const result = await q.one<{ merge_clients: string }>(
          `select app.merge_clients($1, $2, $3, false, $4::jsonb) as merge_clients`,
          [surviving, merged, `${decision} · revisió de duplicats${note ? ` · ${note}` : ''}`,
           JSON.stringify(row.signals ?? {})],
        );

        // ACTUALITZAR EXISTENT additionally fills the survivor's empty
        // descriptive fields from the pre-merge snapshot. Never a unique key,
        // never an overwrite: a merge must not destroy a better value.
        if (decision === 'ACTUALITZAR EXISTENT' && result) {
          const assignments = ENRICH_FIELDS.map(
            (f) => `${f} = coalesce(nullif(btrim(coalesce(c.${f}, '')), ''), s.snapshot -> 'client' ->> '${f}')`,
          ).join(', ');
          await q.run(
            `update public.clients c
                set ${assignments},
                    do_cava = c.do_cava or coalesce((s.snapshot -> 'client' ->> 'do_cava')::boolean, false),
                    do_penedes = c.do_penedes or coalesce((s.snapshot -> 'client' ->> 'do_penedes')::boolean, false),
                    do_catalunya = c.do_catalunya or coalesce((s.snapshot -> 'client' ->> 'do_catalunya')::boolean, false),
                    do_altres = c.do_altres or coalesce((s.snapshot -> 'client' ->> 'do_altres')::boolean, false),
                    client_type_code = coalesce(c.client_type_code, s.snapshot -> 'client' ->> 'client_type_code'),
                    general_notes = case
                      when nullif(btrim(coalesce(s.snapshot -> 'client' ->> 'general_notes', '')), '') is null then c.general_notes
                      when c.general_notes is null then s.snapshot -> 'client' ->> 'general_notes'
                      when position(s.snapshot -> 'client' ->> 'general_notes' in c.general_notes) > 0 then c.general_notes
                      else c.general_notes || E'\n' || (s.snapshot -> 'client' ->> 'general_notes')
                    end
               from public.client_merges s
              where s.id = $2 and c.id = $1`,
            [surviving, result.merge_clients],
          );
        }

        await q.run(record, [id, decision, session.userId, note, session.workspaceId]);
      });
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'CANDIDAT_JA_DECIDIT') {
      return { ok: false, error: 'Aquest candidat ja té una decisió.' };
    }
    return { ok: false, error: adminError(error) };
  }

  revalidatePath('/administracio/duplicats');
  revalidatePath('/clients', 'layout');
  return { ok: true };
}

/**
 * Reverses a merge.
 *
 * `client_merges.snapshot` holds the company, its contacts, its locations and
 * its aliases exactly as they were. What the snapshot does not hold — which
 * activities, tasks, visits and opportunities were moved — is reconstructed
 * from `audit_log`, which recorded every one of those UPDATEs with the old and
 * the new `client_id`. Verifications and voice notes are the two tables the
 * merge touches without an audit trigger; they stay on the surviving company
 * and the screen says so.
 */
export async function undoMerge(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const id = field(formData, 'id');
  const confirmation = field(formData, 'confirmation');
  if (!id) return { ok: false, error: 'Falta la fusió.' };
  if (confirmation !== 'CONFIRMO') return { ok: false, error: 'Cal confirmar explícitament.' };

  try {
    await elevated(session, 'CRM', async (q) => {
      const merge = await q.one<{
        surviving_client_id: string;
        merged_client_id: string;
        merged_at: string;
        undone_at: string | null;
      }>(
        `select surviving_client_id, merged_client_id, merged_at, undone_at
           from public.client_merges where id = $1 and workspace_id = $2`,
        [id, session.workspaceId],
      );
      if (!merge) throw new Error('FUSIO_NO_TROBADA');
      if (merge.undone_at) throw new Error('JA_DESFETA');

      // 1. the company itself
      await q.run(
        `update public.clients set deleted_at = null, deleted_reason = null where id = $1`,
        [merge.merged_client_id],
      );

      // 2. satellites listed in the snapshot, with their original flags
      for (const [table, flag] of [
        ['contacts', 'is_primary'],
        ['client_locations', 'is_primary'],
      ] as const) {
        await q.run(
          `update public.${table} t
              set client_id = $2, ${flag} = coalesce((e.value ->> '${flag}')::boolean, false)
             from public.client_merges m,
                  jsonb_array_elements(m.snapshot -> $4) as e(value)
            where m.id = $1 and t.id = (e.value ->> 'id')::uuid and t.client_id = $3`,
          [id, merge.merged_client_id, merge.surviving_client_id, table === 'contacts' ? 'contacts' : 'locations'],
        );
      }
      await q.run(
        `update public.client_aliases a
            set client_id = $2
           from public.client_merges m,
                jsonb_array_elements(m.snapshot -> 'aliases') as e(value)
          where m.id = $1 and a.id = (e.value ->> 'id')::uuid and a.client_id = $3`,
        [id, merge.merged_client_id, merge.surviving_client_id],
      );
      // aliases the merge itself created on the survivor
      await q.run(
        `delete from public.client_aliases
          where client_id = $1 and source = 'FUSIO'
            and created_at >= $2::timestamptz - interval '1 minute'
            and created_at <= $2::timestamptz + interval '1 minute'`,
        [merge.surviving_client_id, merge.merged_at],
      );

      // 3. rows the merge moved, replayed backwards from the audit trail
      for (const entity of ['activities', 'tasks', 'visits', 'opportunities'] as const) {
        await q.run(
          `update public.${entity} t
              set client_id = $1
            where t.client_id = $2
              and t.id::text in (
                select a.entity_id from public.audit_log a
                 where a.entity = '${entity}' and a.action = 'UPDATE'
                   and a.before_value ->> 'client_id' = $1::text
                   and a.after_value ->> 'client_id' = $2::text
                   and a.created_at between $3::timestamptz - interval '1 minute'
                                        and $3::timestamptz + interval '1 minute'
              )`,
          [merge.merged_client_id, merge.surviving_client_id, merge.merged_at],
        );
      }
      // opportunities the merge parked because they collided on the grain
      await q.run(
        `update public.opportunities o
            set deleted_at = null
          where o.client_id = $1 and o.deleted_at is not null
            and o.id::text in (
              select a.entity_id from public.audit_log a
               where a.entity = 'opportunities' and a.action = 'UPDATE'
                 and a.before_value ->> 'deleted_at' is null
                 and a.after_value ->> 'deleted_at' is not null
                 and a.created_at between $2::timestamptz - interval '1 minute'
                                      and $2::timestamptz + interval '1 minute'
            )`,
        [merge.merged_client_id, merge.merged_at],
      );

      await q.run(
        `update public.client_merges set undone_at = now(), undone_by = $2 where id = $1`,
        [id, session.userId],
      );
      await q.run(`select app.refresh_proposed_classification($1)`, [merge.surviving_client_id]);
      await q.run(`select app.refresh_proposed_classification($1)`, [merge.merged_client_id]);
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'JA_DESFETA') {
      return { ok: false, error: 'Aquesta fusió ja s’havia desfet.' };
    }
    return { ok: false, error: adminError(error) };
  }
  revalidatePath('/administracio/duplicats');
  revalidatePath('/clients', 'layout');
  return { ok: true };
}
