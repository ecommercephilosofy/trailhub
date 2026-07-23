'use server';

import { createHash, randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { query, requireSession, type Session } from '@/lib/auth';
import { friendlyError } from '@/lib/db';
import { interpreter, transcriptionProvider } from '@/lib/voice/providers';
import { storeAudio } from '@/lib/voice/storage';
import {
  validateProposal,
  type CommercialContext,
  type InterpretationProposal,
  type ProposalAction,
} from '@vitalpe/integrations';

/**
 * Voice notes and quick capture.
 *
 * The shape of this file is the safety property: `interpret*` only ever
 * PRODUCES a proposal, and `applyProposal` only ever consumes actions the user
 * has explicitly kept. Nothing the model returns reaches the database without
 * passing back through the browser and a human pressing CONFIRMAR.
 */

export interface ProposalResult {
  ok: boolean;
  error?: string;
  voiceNoteId?: string;
  transcript?: string;
  proposal?: InterpretationProposal;
  dropped?: { reason: string }[];
  providerNotice?: string | null;
  interpreterName?: string;
}

/**
 * Word windows of the transcript, used to look for company mentions.
 * "he visitat bodegas pinord sa i han demanat mostres" yields, among others,
 * "bodegas pinord sa", which the trigram index matches against `name_norm`.
 */
function nameWindows(text: string): string[] {
  const words = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  const windows = new Set<string>();
  // Two to five words: a single word is too noisy for a trigram match, and a
  // company name longer than five words is rare in these sources.
  for (let size = 2; size <= 5; size += 1) {
    for (let i = 0; i + size <= words.length; i += 1) {
      const phrase = words.slice(i, i + size).join(' ');
      if (phrase.length >= 6) windows.add(phrase);
    }
  }
  return [...windows].slice(0, 60);
}

/** The minimum the interpreter needs. Never the whole database. */
async function buildContext(
  session: Session,
  clientId: string | null,
  transcript = '',
): Promise<CommercialContext> {
  return query(session, async (q) => {
    const company = clientId
      ? await q.one<{ id: string; name: string; classification: string | null }>(
          `select id, name, coalesce(confirmed_classification::text, proposed_classification::text) as classification
             from public.clients where id = $1 and deleted_at is null`,
          [clientId],
        )
      : null;

    // Candidates are the companies actually MENTIONED in the text (matched by
    // name or alias through the trigram index), topped up with the user's own
    // portfolio. Sending an arbitrary slice of 250 companies is what makes an
    // interpreter "fail to find" a company that is right there in the database.
    const candidates = clientId
      ? await q.many<{ id: string; name: string; aliases: string[] | null }>(
          `select c.id, c.name, null::text[] as aliases from public.clients c where c.id = $1`,
          [clientId],
        )
      : await q.many<{ id: string; name: string; aliases: string[] | null }>(
          `with windows as (select w from unnest($3::text[]) as w),
           -- Two separate index scans instead of one OR: an OR with an EXISTS
           -- in the join condition forces a nested loop over every company and
           -- turned this into a 13-second query.
           by_name as (
             select c.id, max(similarity(c.name_norm, w.w)) as score
               from windows w
               join public.clients c
                 on c.workspace_id = $1 and c.deleted_at is null and c.name_norm % w.w
              group by c.id
           ),
           by_alias as (
             select a.client_id as id, max(similarity(a.alias_norm, w.w)) as score
               from windows w
               join public.client_aliases a on a.workspace_id = $1 and a.alias_norm % w.w
              group by a.client_id
           ),
           mentioned as (
             select id, max(score) as score
               from (select * from by_name union all select * from by_alias) u
              group by id
              order by score desc
              limit 15
           ),
           portfolio as (
             select c.id, 0.0 as score
               from public.clients c
               join public.client_assignments ca
                 on ca.client_id = c.id and ca.user_id = $2 and ca.is_active
              where c.workspace_id = $1 and c.deleted_at is null
              order by c.updated_at desc
              limit 60
           ),
           merged as (
             select id, max(score) as score from (
               select * from mentioned union all select * from portfolio
             ) u group by id
           )
           select c.id, c.name,
                  array(select a.alias from public.client_aliases a
                         where a.client_id = c.id limit 5) as aliases
             from merged m
             join public.clients c on c.id = m.id
            order by m.score desc, c.name
            limit 75`,
          [session.workspaceId, session.userId, nameWindows(transcript)],
        );

    const contacts = clientId
      ? await q.many<{ id: string; name: string; role: string | null }>(
          `select id, btrim(concat_ws(' ', first_name, last_name)) as name, role_title as role
             from public.contacts
            where client_id = $1 and deleted_at is null and is_active
            order by is_primary desc limit 10`,
          [clientId],
        )
      : [];

    const catalogue = await q.many<{ id: string; name: string }>(
      `select id, name from public.products where deleted_at is null and is_active order by sort_order`,
    );

    const recent = clientId
      ? await q.many<{ date: string; type: string; result: string | null; summary: string | null }>(
          `select occurred_on::text as date, activity_type::text as type,
                  result::text as result, left(coalesce(notes, ''), 160) as summary
             from public.activities
            where client_id = $1 and deleted_at is null
            order by occurred_on desc, created_at desc limit 5`,
          [clientId],
        )
      : [];

    const pending = clientId
      ? await q.many<{ id: string; action: string; dueAt: string | null; title: string | null }>(
          `select id, action::text as action, due_at::text as "dueAt", title
             from public.tasks
            where client_id = $1 and deleted_at is null and status = 'PENDENT'
            order by due_at nulls last limit 10`,
          [clientId],
        )
      : [];

    return {
      workspaceId: session.workspaceId,
      ...(company ? { company: { id: company.id, name: company.name, ...(company.classification ? { classification: company.classification } : {}) } } : {}),
      candidateCompanies: candidates.map((c) => ({
        id: c.id,
        name: c.name,
        ...(c.aliases && c.aliases.length > 0 ? { aliases: c.aliases } : {}),
      })),
      contacts: contacts.filter((c) => c.name).map((c) => ({ id: c.id, name: c.name, ...(c.role ? { role: c.role } : {}) })),
      catalogue,
      recentHistory: recent.map((r) => ({
        date: r.date, type: r.type,
        ...(r.result ? { result: r.result } : {}),
        ...(r.summary ? { summary: r.summary } : {}),
      })),
      pendingTasks: pending.map((p) => ({
        id: p.id, action: p.action,
        ...(p.dueAt ? { dueAt: p.dueAt } : {}),
        ...(p.title ? { title: p.title } : {}),
      })),
      currentDate: new Date().toISOString(),
      timeZone: 'Europe/Madrid',
    } satisfies CommercialContext;
  });
}

/** Runs the interpreter and stores the proposal. Applies nothing. */
async function propose(
  session: Session,
  text: string,
  clientId: string | null,
  origin: string,
  audio: { path: string; bytes: number; format: string; durationSeconds: number | null } | null,
): Promise<ProposalResult> {
  const trimmed = text.trim();
  if (trimmed.length < 3) {
    return { ok: false, error: 'Cal un text o una transcripció per interpretar.' };
  }

  const { provider, info } = interpreter();
  const context = await buildContext(session, clientId, trimmed);

  let raw: InterpretationProposal;
  try {
    raw = await provider.interpret({ transcript: trimmed, context });
  } catch (error) {
    return { ok: false, error: `No s'ha pogut interpretar el text: ${(error as Error).message}` };
  }

  // Re-validate whatever came back, whichever provider produced it. An action
  // outside the closed list is dropped, never coerced into a nearby one.
  const { proposal, dropped } = validateProposal(
    { actions: raw.actions, ambiguities: raw.ambiguities, confidence: raw.confidence, summary: raw.summary },
    { provider: raw.provider, ...(raw.model ? { model: raw.model } : {}) },
  );

  try {
    const voiceNoteId = await query(session, async (q) => {
      const note = await q.one<{ id: string }>(
        `insert into public.voice_notes
           (workspace_id, user_id, client_id, origin_context, audio_path, audio_bytes,
            audio_format, audio_duration_s, transcript, transcription_status,
            transcription_provider, interpretation_status, interpretation_provider,
            model_version, confidence, summary, detected_language)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'FET',$10,'FET',$11,$12,$13,$14,'ca')
         returning id`,
        [
          session.workspaceId, session.userId, clientId, origin,
          audio?.path ?? null, audio?.bytes ?? null, audio?.format ?? null,
          audio?.durationSeconds ?? null, trimmed,
          audio ? transcriptionProvider().info.name : 'text',
          proposal.provider, proposal.model ?? null, proposal.confidence, proposal.summary,
        ],
      );
      if (!note) throw new Error('No s\'ha pogut desar la nota.');

      // The idempotency key is derived from the content, so a double submit
      // cannot create two applicable proposals for the same note.
      const key = createHash('sha256')
        .update(`${session.userId}|${clientId ?? ''}|${trimmed}`)
        .digest('hex');

      await q.run(
        `insert into public.voice_interpretation_proposals
           (workspace_id, voice_note_id, transcript_original, proposal_original,
            ambiguities, confidence, idempotency_key)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (workspace_id, idempotency_key) do nothing`,
        [
          session.workspaceId, note.id, trimmed, JSON.stringify(proposal),
          JSON.stringify(proposal.ambiguities), proposal.confidence, key,
        ],
      );
      return note.id;
    }, 'VEU');

    return {
      ok: true,
      voiceNoteId,
      transcript: trimmed,
      proposal,
      dropped: dropped.map((d) => ({ reason: d.reason })),
      providerNotice: info.notice,
      interpreterName: info.name,
    };
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
}

/** REGISTRE RÀPID: free text or a pasted transcript. */
export async function interpretText(formData: FormData): Promise<ProposalResult> {
  const session = await requireSession();
  return propose(
    session,
    String(formData.get('text') ?? ''),
    String(formData.get('clientId') ?? '') || null,
    String(formData.get('origin') ?? 'REGISTRE RÀPID'),
    null,
  );
}

/** Uploads the recording, transcribes it, then proposes. */
export async function interpretAudio(formData: FormData): Promise<ProposalResult> {
  const session = await requireSession();
  const file = formData.get('audio');
  if (!(file instanceof File)) return { ok: false, error: 'No s\'ha rebut cap àudio.' };

  const clientId = String(formData.get('clientId') ?? '') || null;
  const durationRaw = Number(formData.get('duration') ?? 0);
  const duration = Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : null;
  const format = (file.type.split('/')[1] ?? 'webm').split(';')[0] ?? 'webm';

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.byteLength === 0) return { ok: false, error: 'L\'àudio és buit.' };
  if (bytes.byteLength > 25 * 1024 * 1024) {
    return { ok: false, error: 'L\'àudio supera els 25 MB.' };
  }

  const { provider, info } = transcriptionProvider();
  const result = await provider.transcribe({
    kind: 'audio',
    data: bytes,
    format: format as 'webm' | 'm4a' | 'mp3' | 'wav',
    ...(duration ? { durationSeconds: duration } : {}),
    languageHint: 'ca',
  });

  if (result.status !== 'OK') {
    // Not an error state: the recording is kept so the user can paste the
    // transcript by hand and continue.
    let stored: { path: string; bytes: number } | null = null;
    try {
      stored = await storeAudio(session.workspaceId, session.userId, bytes, format);
    } catch {
      stored = null;
    }
    if (stored) {
      await query(session, async (q) => {
        await q.run(
          `insert into public.voice_notes
             (workspace_id, user_id, client_id, origin_context, audio_path, audio_bytes,
              audio_format, audio_duration_s, transcription_status, transcription_provider,
              interpretation_status, error)
           values ($1,$2,$3,'REGISTRE DE VEU',$4,$5,$6,$7,'NO DISPONIBLE',$8,'PENDENT',$9)`,
          [
            session.workspaceId, session.userId, clientId, stored.path, stored.bytes,
            format, duration, info.name, result.message,
          ],
        );
      }, 'VEU');
    }
    return {
      ok: false,
      error: result.message,
      providerNotice: info.notice,
    };
  }

  const stored = await storeAudio(session.workspaceId, session.userId, bytes, format);
  return propose(session, result.transcript, clientId, 'REGISTRE DE VEU', {
    path: stored.path,
    bytes: stored.bytes,
    format,
    durationSeconds: duration,
  });
}

// ---------------------------------------------------------------------------
// Applying a confirmed proposal
// ---------------------------------------------------------------------------

export interface ApplyResult {
  ok: boolean;
  error?: string;
  summary?: string[];
}

/**
 * Applies exactly the actions the user kept, in one transaction.
 *
 * Deliberately NOT supported here, whatever the model proposes:
 * deleting or merging companies, deleting history, confirming a
 * classification, inviting users, changing roles or integrations, sending
 * e-mail. Those actions have no branch in this switch and no schema variant,
 * so they are unrepresentable rather than merely rejected.
 */
export async function applyProposal(formData: FormData): Promise<ApplyResult> {
  const session = await requireSession();
  const voiceNoteId = String(formData.get('voiceNoteId') ?? '');
  const raw = String(formData.get('actions') ?? '[]');

  let actions: ProposalAction[];
  try {
    const { proposal } = validateProposal({ actions: JSON.parse(raw) }, { provider: 'confirmat' });
    actions = [...proposal.actions];
  } catch {
    return { ok: false, error: 'Les accions confirmades no són vàlides.' };
  }
  if (actions.length === 0) return { ok: false, error: 'No has seleccionat cap acció.' };

  const summary: string[] = [];

  try {
    await query(session, async (q) => {
      const note = await q.one<{ id: string; client_id: string | null; applied: string | null }>(
        `select v.id, v.client_id, p.applied_at::text as applied
           from public.voice_notes v
           left join public.voice_interpretation_proposals p on p.voice_note_id = v.id
          where v.id = $1 and v.user_id = $2`,
        [voiceNoteId, session.userId],
      );
      if (!note) throw new Error('NOTA_NO_TROBADA');
      if (note.applied) throw new Error('PROPOSTA_JA_APLICADA');

      const resolve = async (ref: { clientId?: string; name?: string }): Promise<string | null> => {
        if (ref.clientId) return ref.clientId;
        if (!ref.name) return note.client_id;
        const hit = await q.one<{ id: string }>(
          `select c.id from public.clients c
            where c.workspace_id = $1 and c.deleted_at is null
              and c.name_norm = app.normalize_company($2)
            union all
           select a.client_id from public.client_aliases a
            where a.workspace_id = $1 and a.alias_norm = app.normalize_company($2)
            limit 1`,
          [session.workspaceId, ref.name],
        );
        return hit?.id ?? note.client_id;
      };

      for (const action of actions) {
        switch (action.type) {
          case 'REGISTRAR_ACTIVITAT': {
            const clientId = await resolve(action.client);
            if (!clientId) break;
            await q.run(
              `insert into public.activities
                 (workspace_id, client_id, occurred_on, activity_type, result, notes,
                  user_id, source_voice_note_id, origin)
               values ($1,$2,coalesce($3::date, (now() at time zone 'Europe/Madrid')::date),
                       $4::app.activity_type, $5::app.activity_result, $6, $7, $8, 'VEU')`,
              [
                session.workspaceId, clientId, action.occurredAt ?? null, action.activityType,
                action.result ?? null, action.summary, session.userId, voiceNoteId,
              ],
            );
            summary.push(`Acció registrada: ${action.activityType}`);
            break;
          }

          case 'CREAR_TASCA': {
            const clientId = await resolve(action.client);
            await q.run(
              `insert into public.tasks
                 (workspace_id, kind, action, other_action, sample_subtype, client_id, title,
                  due_at, priority, assigned_to, created_by, notes, source_voice_note_id)
               values ($1,'TASCA',$2::app.commercial_action,$3,
                       nullif($4,'')::app.sample_subtype,$5,$6,
                       case when $7::text is null then null else $7::timestamptz end,
                       $8::app.task_priority,$9,$9,$10,$11)`,
              [
                session.workspaceId, action.action, action.otherAction ?? null,
                action.sampleSubtype ?? '', clientId,
                action.title ?? action.otherAction ?? action.action,
                action.dueAt ?? null, action.priority, session.userId,
                action.notes ?? null, voiceNoteId,
              ],
            );
            summary.push(
              action.dueAt
                ? `Tasca creada: ${action.action}`
                : `Tasca creada sense data: ${action.action}`,
            );
            break;
          }

          case 'PROGRAMAR_VISITA': {
            const clientId = await resolve(action.client);
            if (!clientId) break;
            const ends =
              action.endsAt ?? new Date(new Date(action.startsAt).getTime() + 3_600_000).toISOString();
            await q.run(
              `select app.create_visit_with_task($1,$2,$3,$4::timestamptz,$5::timestamptz,
                                                 null,null,$6,$7::app.task_priority,true,true)`,
              [
                session.workspaceId, clientId, session.userId, action.startsAt, ends,
                action.objective ?? null, action.priority,
              ],
            );
            summary.push('Visita programada (amb la seva tasca)');
            break;
          }

          case 'REGISTRAR_OPORTUNITAT': {
            const clientId = await resolve(action.client);
            if (!clientId) break;
            const product = action.product
              ? await q.one<{ id: string }>(
                  `select id from public.products
                    where deleted_at is null and name_norm = app.normalize_text($1) limit 1`,
                  [action.product],
                )
              : null;
            if (!product) {
              // No catalogue product, no opportunity: the grain requires one and
              // guessing would invent a product line.
              summary.push(
                `Oportunitat no creada: el producte «${action.product ?? '(no indicat)'}» no és al catàleg. S'ha desat com a nota.`,
              );
              await q.run(
                `insert into public.activities
                   (workspace_id, client_id, activity_type, result, notes, user_id,
                    source_voice_note_id, origin)
                 values ($1,$2,'NOTA INTERNA','NO DETERMINAT',$3,$4,$5,'VEU')`,
                [
                  session.workspaceId, clientId,
                  `Oportunitat proposada des de veu, producte fora de catàleg: ${action.product ?? '(no indicat)'}. ${action.notes ?? ''}`,
                  session.userId, voiceNoteId,
                ],
              );
              break;
            }
            const campaign = await q.one<{ id: string }>(
              `select id from public.campaigns where status = 'OBERTA' order by year_start desc limit 1`,
            );
            await q.run(
              `insert into public.opportunities
                 (workspace_id, client_id, product_id, campaign_id, data_type, volume_liters,
                  notes, source, owner_id)
               values ($1,$2,$3,$4,$5::app.opportunity_data_type,$6,$7,'NOTA DE VEU',$8)
               on conflict (client_id, product_id, campaign_id, data_type) where deleted_at is null
               do update set volume_liters = coalesce(excluded.volume_liters, public.opportunities.volume_liters),
                             notes = coalesce(excluded.notes, public.opportunities.notes)`,
              [
                session.workspaceId, clientId, product.id, campaign?.id, action.dataType,
                action.quantityLiters ?? null, action.notes ?? null, session.userId,
              ],
            );
            summary.push(`Oportunitat registrada: ${action.dataType}`);
            break;
          }

          case 'ACTUALITZAR_CLASSIFICACIO': {
            const clientId = await resolve(action.client);
            if (!clientId) break;
            // The AI never confirms a classification. The suggestion is recorded
            // as an internal note and surfaced on the company card, where a
            // person confirms it.
            await q.run(
              `insert into public.activities
                 (workspace_id, client_id, activity_type, result, notes, user_id,
                  source_voice_note_id, origin)
               values ($1,$2,'NOTA INTERNA','NO DETERMINAT',$3,$4,$5,'VEU')`,
              [
                session.workspaceId, clientId,
                `PROPOSTA DE CLASSIFICACIÓ des de veu: ${action.classification}. ${action.reason ?? ''} — cal confirmació manual a la fitxa.`,
                session.userId, voiceNoteId,
              ],
            );
            summary.push(
              `Classificació ${action.classification} proposada com a nota. La confirmació és manual.`,
            );
            break;
          }

          case 'AFEGIR_NOTA': {
            const clientId = action.client ? await resolve(action.client) : note.client_id;
            if (!clientId) break;
            await q.run(
              `insert into public.activities
                 (workspace_id, client_id, activity_type, result, notes, user_id,
                  source_voice_note_id, origin)
               values ($1,$2,'NOTA INTERNA','NO DETERMINAT',$3,$4,$5,'VEU')`,
              [session.workspaceId, clientId, action.text, session.userId, voiceNoteId],
            );
            summary.push('Nota afegida a l\'historial');
            break;
          }
        }
      }

      await q.run(
        `update public.voice_interpretation_proposals
            set confirmed_actions = $2, confirmed_by = $3, confirmed_at = now(), applied_at = now()
          where voice_note_id = $1`,
        [voiceNoteId, JSON.stringify(actions), session.userId],
      );
      await q.run(
        `update public.voice_notes set confirmed_at = now() where id = $1`,
        [voiceNoteId],
      );

      // Retention: by default the audio goes as soon as the note is confirmed.
      await q.run(
        `update public.voice_notes
            set audio_deleted_at = now()
          where id = $1 and retention_policy = 'DELETE_AFTER_CONFIRM' and audio_path is not null`,
        [voiceNoteId],
      );
    }, 'VEU');
  } catch (error) {
    const message = (error as Error).message;
    if (message.includes('PROPOSTA_JA_APLICADA')) {
      return { ok: false, error: 'Aquesta proposta ja s\'havia aplicat.' };
    }
    if (message.includes('NOTA_NO_TROBADA')) {
      return { ok: false, error: 'La nota de veu no existeix o no és teva.' };
    }
    return { ok: false, error: friendlyError(error) };
  }

  revalidatePath('/inici');
  revalidatePath('/tasques');
  revalidatePath('/clients', 'layout');
  return { ok: true, summary };
}

export async function discardProposal(formData: FormData): Promise<{ ok: boolean }> {
  const session = await requireSession();
  const voiceNoteId = String(formData.get('voiceNoteId') ?? '');
  await query(session, async (q) => {
    await q.run(
      `update public.voice_interpretation_proposals
          set discarded_actions = proposal_original -> 'actions', confirmed_at = now(),
              confirmed_by = $2
        where voice_note_id = $1`,
      [voiceNoteId, session.userId],
    );
  }, 'VEU');
  return { ok: true };
}

/** Used by the mobile app and the offline queue. */
export async function newIdempotencyKey(): Promise<string> {
  return randomUUID();
}
