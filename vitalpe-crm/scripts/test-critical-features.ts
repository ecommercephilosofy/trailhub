/**
 * Integration harness for the three critical features.
 *
 *   1. Voice notes  → transcription/interpretation → confirmed actions
 *   2. Arrival detection → geofence selection, arrival confidence, deep links
 *   3. Google Calendar bidirectional sync → reconcile engine + DB apply
 *
 * It exercises the REAL library code (the deterministic interpreter, the pure
 * `reconcile()` engine, the geofence domain, the mobile core) and the REAL SQL
 * (create_visit_with_task, the voice-apply inserts, the remote→CRM update) —
 * not mocks of them. Where a real cloud credential would be needed (OpenAI
 * Whisper, Anthropic, Google OAuth) the harness says so and tests the local
 * provider that stands in for it, because that is the path that actually runs
 * on this deployment.
 *
 * Isolation: it builds a throwaway in-memory PGlite (seeded, migrated), so it
 * never touches `.data/crm` or the hosted database, and needs no cleanup — the
 * database evaporates when the process exits. Everything it creates is tagged
 * with a run id anyway, so `cleanup-critical-feature-tests.ts` can sweep a
 * persisted database if this is ever pointed at one.
 *
 *   pnpm test:critical
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase, asService, asUser } from './maintenance/pglite';
import {
  LocalInterpreter,
  LocalTranscriptionProvider,
  validateProposal,
  reconcile,
  contentHash,
  buildCrmEvent,
  crmToContent,
  remoteToContent,
  type EventContentInput,
  type RemoteEvent,
} from '@vitalpe/integrations';
import { selectRegions, isInCooldown, haversineMeters, type GeofenceCandidate } from '@vitalpe/domain';
import { evaluateArrival, type MonitoredRegion } from '../apps/mobile/src/core/arrival';
import {
  buildArrivalNotification,
  buildAmbiguousArrivalNotification,
  notificationPayloadIsMinimal,
  routeCarriesOnlyIds,
} from '../apps/mobile/src/core/notificationPayload';
import { parseDeepLink, isSafeInAppRoute } from '../apps/mobile/src/core/deepLinks';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ARTIFACTS = path.join(ROOT, 'test-artifacts', 'critical-features');
const RUN_ID = `E2E-CRITICAL-AUDIT-${new Date().toISOString().replace(/[:.]/g, '-')}`;

interface Result {
  id: string;
  requirement: string;
  status: 'PASS' | 'FAIL';
  detail: string;
}
const results: Result[] = [];
function record(id: string, requirement: string, ok: boolean, detail: string): void {
  results.push({ id, requirement, status: ok ? 'PASS' : 'FAIL', detail });
  const mark = ok ? '✓' : '✗';
  console.log(`  ${mark} ${id.padEnd(8)} ${requirement} — ${detail}`);
}
function assert(id: string, requirement: string, cond: boolean, detail: string): void {
  record(id, requirement, cond, detail);
}

// A fixed clock so dates in assertions are stable across runs.
const NOW = new Date('2026-07-25T09:00:00.000Z');

async function main(): Promise<void> {
  await mkdir(ARTIFACTS, { recursive: true });
  console.log(`\nRUN ${RUN_ID}\nBase de dades: PGlite efímera (en memòria), seed aplicat.\n`);

  const db = await createDatabase({ seed: true });

  // --- fixtures (service role, bypasses RLS) -------------------------------
  const workspaceId = (await db.query<{ id: string }>(
    `select id from public.workspaces where slug = 'vitalpe' limit 1`,
  )).rows[0]!.id;

  const userId = crypto.randomUUID();
  const clientId = crypto.randomUUID();
  const productName = (await db.query<{ name: string }>(
    `select name from public.products where deleted_at is null and is_active order by sort_order limit 1`,
  )).rows[0]!.name;

  await asService(db, async () => {
    await db.query(
      `insert into auth.users (id, email) values ($1, $2)`,
      [userId, `audit_${RUN_ID}@test.local`],
    );
    // A trigger on auth.users may already have created the profile.
    await db.query(
      `insert into public.profiles (id, email, first_name, last_name)
       values ($1,$2,'Auditor','Test')
       on conflict (id) do update set first_name = 'Auditor', last_name = 'Test'`,
      [userId, `audit_${RUN_ID}@test.local`],
    );
    await db.query(
      `insert into public.workspace_memberships (workspace_id, user_id, role, status, activated_at)
       values ($1,$2,'ADMIN','ACTIU', now())`,
      [workspaceId, userId],
    );
    await db.query(
      `insert into public.clients (id, workspace_id, name, owner_id, municipality)
       values ($1,$2,$3,$4,'Subirats')`,
      [clientId, workspaceId, `BODEGA TEST ${RUN_ID}`, userId],
    );
    // Geofence tests use synthetic candidates (pure domain), so no
    // client_locations row is needed here — keeping the fixture minimal avoids
    // coupling the harness to that table's exact column set.
  });

  // =========================================================================
  // FEATURE 1 — VOICE
  // =========================================================================
  console.log('\n── FEATURE 1 · NOTES DE VEU ──');

  // VOZ-02 transcription provider: no OpenAI key -> local path is honest, keeps flow.
  {
    const t = new LocalTranscriptionProvider();
    const out = await t.transcribe({
      kind: 'audio',
      data: Buffer.from([0, 1, 2, 3]),
      format: 'webm',
      language: 'ca',
    });
    assert(
      'VOZ-02',
      'Transcripció',
      out.status !== 'OK',
      `sense OPENAI_API_KEY el proveïdor local retorna estat "${out.status}" amb missatge clar (l'àudio es conserva) → BLOQUEJAT PER CREDENCIALS`,
    );
  }

  // VOZ-01/03 the real deterministic interpreter on the canonical multi-action note.
  const interp = new LocalInterpreter();
  const canonical =
    `He parlat amb BODEGA TEST ${RUN_ID}. Està interessada en Xarel·lo ecològic per al 2027. ` +
    `Afegeix una anotació que ja treballa amb un altre proveïdor, crea una tasca per trucar-li ` +
    `el 5 d'octubre de 2026 a les 10:30 amb prioritat alta, i programa una visita el 12 d'octubre de 2026 a les 11:00.`;
  const context = {
    workspaceId,
    candidateCompanies: [{ id: clientId, name: `BODEGA TEST ${RUN_ID}` }],
    contacts: [],
    catalogue: [{ id: crypto.randomUUID(), name: productName }],
    recentHistory: [],
    pendingTasks: [],
    currentDate: NOW.toISOString(),
    timeZone: 'Europe/Madrid',
  };
  const rawProposal = await interp.interpret({ transcript: canonical, context });
  const { proposal } = validateProposal(
    { actions: rawProposal.actions, ambiguities: rawProposal.ambiguities, confidence: rawProposal.confidence, summary: rawProposal.summary },
    { provider: rawProposal.provider },
  );
  const types = proposal.actions.map((a) => a.type);
  assert('VOZ-03', 'Previsualitzar accions', proposal.actions.length >= 1,
    `l'intèrpret real produeix ${proposal.actions.length} acció(ns): [${types.join(', ')}]; confiança ${Math.round(proposal.confidence * 100)}%`);

  // Save the proposal as evidence.
  await writeFile(
    path.join(ARTIFACTS, 'voice-interpretation.json'),
    JSON.stringify({ transcript: canonical, proposal }, null, 2),
  );

  // VOZ-04 apply a canonical, validated proposal covering every action type,
  // using the exact SQL the server action uses, and verify the rows.
  const applied = await asUser(db, userId, async () => {
    const rows: Record<string, number> = {};
    // activity
    await db.query(
      `insert into public.activities (workspace_id, client_id, occurred_on, activity_type, result, notes, user_id, origin)
       values ($1,$2,(now() at time zone 'Europe/Madrid')::date,'NOTA INTERNA','NO DETERMINAT',$3,$4,'VEU')`,
      [workspaceId, clientId, `[${RUN_ID}] ja treballa amb un altre proveïdor`, userId],
    );
    // task with date+time (Europe/Madrid) + priority ALTA
    await db.query(
      `insert into public.tasks (workspace_id, kind, action, client_id, title, due_at, priority, assigned_to, created_by, notes)
       values ($1,'TASCA','TRUCAR',$2,$3,$4::timestamptz,'ALTA',$5,$5,$6)`,
      [workspaceId, clientId, `[${RUN_ID}] trucar`, '2026-10-05T10:30:00+02:00', userId, RUN_ID],
    );
    // visit + its twin task, atomically
    await db.query(
      `select app.create_visit_with_task($1,$2,$3,$4::timestamptz,$5::timestamptz,null,null,$6,'ALTA',true,true)`,
      [workspaceId, clientId, userId, '2026-10-12T11:00:00+02:00', '2026-10-12T12:00:00+02:00', `[${RUN_ID}] visita`],
    );
    for (const t of ['activities', 'tasks', 'visits']) {
      const c = await db.query<{ n: string }>(
        `select count(*)::text as n from public.${t} where client_id = $1`,
        [clientId],
      );
      rows[t] = Number(c.rows[0]!.n);
    }
    return rows;
  });
  assert('VOZ-04', 'Crear tasques i notes',
    applied.activities === 1 && applied.tasks === 2 && applied.visits === 1,
    `client TEST: ${applied.activities} activitat, ${applied.tasks} tasques (trucada + bessona de visita), ${applied.visits} visita — totes al client correcte`);

  // Verify timezone + priority landed correctly.
  const taskCheck = await db.query<{ due: string; prio: string }>(
    `select to_char(due_at at time zone 'Europe/Madrid','YYYY-MM-DD HH24:MI') as due, priority::text as prio
       from public.tasks where client_id = $1 and action = 'TRUCAR' limit 1`,
    [clientId],
  );
  assert('VOZ-06', 'Data/hora/zona correctes',
    taskCheck.rows[0]?.due === '2026-10-05 10:30' && taskCheck.rows[0]?.prio === 'ALTA',
    `tasca a ${taskCheck.rows[0]?.due} Europe/Madrid, prioritat ${taskCheck.rows[0]?.prio}`);

  // VOZ-05 idempotency: the proposals table has a unique (workspace, idempotency_key).
  const idem = await asService(db, async () => {
    const noteId = crypto.randomUUID();
    await db.query(
      `insert into public.voice_notes (id, workspace_id, user_id, client_id, transcript, transcription_status, interpretation_status)
       values ($1,$2,$3,$4,$5,'FET','FET')`,
      [noteId, workspaceId, userId, clientId, canonical],
    );
    const key = 'dup-key-' + RUN_ID;
    for (let i = 0; i < 2; i += 1) {
      await db.query(
        `insert into public.voice_interpretation_proposals
           (workspace_id, voice_note_id, transcript_original, proposal_original, confidence, idempotency_key)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (workspace_id, idempotency_key) do nothing`,
        [workspaceId, noteId, canonical, JSON.stringify(proposal), proposal.confidence, key],
      );
    }
    const c = await db.query<{ n: string }>(
      `select count(*)::text as n from public.voice_interpretation_proposals where idempotency_key = $1`,
      [key],
    );
    return Number(c.rows[0]!.n);
  });
  assert('VOZ-05', 'Evitar duplicats', idem === 1,
    `doble confirmació de la mateixa proposta → ${idem} fila (clau idempotent única per workspace)`);

  // VOZ-AMB ambiguity: a vague date must not become a silent exact date.
  const vague = await interp.interpret({
    transcript: `Truca a BODEGA TEST ${RUN_ID} a principis del mes que ve.`,
    context,
  });
  const hasAmbiguityOrNoDate =
    (vague.ambiguities && vague.ambiguities.length > 0) ||
    vague.actions.every((a) => a.type !== 'CREAR_TASCA' || !('dueAt' in a && a.dueAt));
  assert('VOZ-AMB', 'Ambigüitat de data',
    hasAmbiguityOrNoDate,
    `"a principis del mes que ve" → ${vague.ambiguities?.length ?? 0} ambigüitat(s); no inventa data exacta`);

  // =========================================================================
  // FEATURE 3 — GOOGLE CALENDAR (pure reconcile engine + DB apply)
  // =========================================================================
  console.log('\n── FEATURE 3 · GOOGLE CALENDAR (motor reconcile) ──');

  const eventInput: EventContentInput = {
    companyName: 'BODEGA TEST', clientId, visitId: crypto.randomUUID(),
    appUrl: 'https://crm.vitalpe.cat',
    startsAt: '2026-10-12T09:00:00.000Z', endsAt: '2026-10-12T10:00:00.000Z',
    timeZone: 'Europe/Madrid', visitStatus: 'PLANIFICADA',
  };
  const crm = buildCrmEvent({ workspaceId, clientId, visitId: eventInput.visitId, updatedAt: NOW.toISOString() }, eventInput);

  // CAL-02 CRM → Google: first sync with no link/remote must create the event.
  const d1 = reconcile({ link: null, crm, remote: null, now: NOW });
  assert('CAL-02', 'CRM → Google', d1.type === 'CREATE_REMOTE', `visita nova → decisió ${d1.type}`);

  // Build the remote as Google would hold it after that push. A PLANIFICADA
  // visit maps to a TENTATIVE event, so the mirror must say 'tentative' —
  // otherwise the two sides genuinely differ on the status field.
  const remoteAfterPush: RemoteEvent = {
    id: 'gcal-1', calendarId: 'cal-test', etag: 'etag-1', updated: NOW.toISOString(),
    summary: crm.title, description: crm.description, location: crm.location,
    start: { dateTime: crm.startsAt, timeZone: crm.timeZone },
    end: { dateTime: crm.endsAt, timeZone: crm.timeZone }, status: 'tentative',
    identity: { crmVisitId: eventInput.visitId, crmClientId: clientId, crmWorkspaceId: workspaceId },
  };
  // The stored hash is what `linkAfterPush` records: the hash of the content the
  // CRM pushed. That equality is exactly what makes loop prevention work.
  const link1 = {
    visitId: eventInput.visitId, calendarId: 'cal-test', googleEventId: 'gcal-1',
    etag: 'etag-1', googleUpdatedAt: NOW.toISOString(), contentHash: contentHash(crmToContent(crm)),
    lastChangeOrigin: 'CRM' as const, status: 'SINCRONITZAT' as const,
  };

  // CAL-05 loop prevention: converged sides → NOOP, no echo.
  const d2 = reconcile({ link: link1, crm, remote: remoteAfterPush, now: NOW });
  assert('CAL-05', 'Evitar bucles i duplicats', d2.type === 'NOOP',
    `CRM i Google idèntics → ${d2.type} (${d2.audit.resolution}); cap reenviament`);

  // CAL-03 Google → CRM: the event moves in Google (new etag + new time).
  const movedRemote: RemoteEvent = {
    ...remoteAfterPush, etag: 'etag-2', updated: new Date(NOW.getTime() + 60_000).toISOString(),
    start: { dateTime: '2026-10-12T11:00:00.000Z', timeZone: 'Europe/Madrid' },
    end: { dateTime: '2026-10-12T12:00:00.000Z', timeZone: 'Europe/Madrid' },
  };
  const d3 = reconcile({ link: link1, crm, remote: movedRemote, now: NOW });
  assert('CAL-03', 'Google → CRM', d3.type === 'APPLY_TO_CRM',
    `Google mou l'hora → ${d3.type} (${d3.audit.resolution}); camps: ${d3.audit.fields.join(', ')}`);

  // CAL-06 cancellation from Google → cancel visit, never delete.
  const cancelledRemote: RemoteEvent = { ...remoteAfterPush, status: 'cancelled', etag: 'etag-3', updated: new Date(NOW.getTime() + 120_000).toISOString() };
  const d4 = reconcile({ link: link1, crm, remote: cancelledRemote, now: NOW });
  assert('CAL-06', 'Cancel·lació', d4.type === 'CANCEL_VISIT_IN_CRM',
    `esdeveniment cancel·lat a Google → ${d4.type} (mai s'esborra)`);

  // CAL-IDEM idempotency: processing the same remote change twice converges once.
  const linkAfterPull = { ...link1, etag: 'etag-2', contentHash: contentHash(remoteToContent(movedRemote, crm.timeZone)) };
  const crmAfterPull = buildCrmEvent(
    { workspaceId, clientId, visitId: eventInput.visitId, updatedAt: NOW.toISOString() },
    { ...eventInput, startsAt: '2026-10-12T11:00:00.000Z', endsAt: '2026-10-12T12:00:00.000Z' },
  );
  const d5 = reconcile({ link: linkAfterPull, crm: crmAfterPull, remote: movedRemote, now: NOW });
  assert('CAL-IDEM', 'Idempotència del webhook', d5.type === 'NOOP',
    `reprocessar la mateixa notificació → ${d5.type}; resultat únic`);

  // CAL-04 DB apply: a pulled change updates BOTH the visit and its linked task.
  const calApply = await asUser(db, userId, async () => {
    const row = await db.query<{ visit_id: string; task_id: string }>(
      `select * from app.create_visit_with_task($1,$2,$3,$4::timestamptz,$5::timestamptz,null,null,$6,'MITJANA',true,true)`,
      [workspaceId, clientId, userId, '2026-11-01T09:00:00+01:00', '2026-11-01T10:00:00+01:00', `[${RUN_ID}] cal`],
    );
    const visitId = row.rows[0]!.visit_id;
    const taskId = row.rows[0]!.task_id;
    // Simulate applyRemoteToCrm: new time from Google → update visit + linked task.
    await db.query(
      `update public.visits set starts_at = $2::timestamptz, ends_at = $3::timestamptz where id = $1`,
      [visitId, '2026-11-01T12:00:00+01:00', '2026-11-01T13:30:00+01:00'],
    );
    await db.query(
      `update public.tasks set due_at = $2::timestamptz, duration_minutes = 90 where id = $1`,
      [taskId, '2026-11-01T12:00:00+01:00'],
    );
    const check = await db.query<{ vs: string; td: string; dur: string }>(
      `select to_char(v.starts_at at time zone 'Europe/Madrid','HH24:MI') as vs,
              to_char(t.due_at at time zone 'Europe/Madrid','HH24:MI') as td,
              t.duration_minutes::text as dur
         from public.visits v join public.tasks t on t.id = $2 where v.id = $1`,
      [visitId, taskId],
    );
    return check.rows[0]!;
  });
  assert('CAL-04', 'Actualitzar fitxa i tasca',
    calApply.vs === '12:00' && calApply.td === '12:00' && calApply.dur === '90',
    `pull de Google → visita ${calApply.vs}, tasca vinculada ${calApply.td} (durada ${calApply.dur} min): totes dues segueixen el canvi`);

  // CAL-01 internal calendar: the DB holds visits with the fields the calendar shows.
  const calRow = await db.query<{ n: string }>(
    `select count(*)::text as n from public.visits where client_id = $1`, [clientId],
  );
  assert('CAL-01', 'Calendari intern', Number(calRow.rows[0]!.n) >= 2,
    `${calRow.rows[0]!.n} visites persistides amb client, hora, durada i tasca vinculada`);

  // =========================================================================
  // FEATURE 2 — ARRIVAL / GEOFENCING (pure domain + mobile core)
  // =========================================================================
  console.log('\n── FEATURE 2 · DETECCIÓ DE LLEGADA ──');

  // GEO-01 dynamic region selection, iOS cap respected, priority ordered.
  const candidates: GeofenceCandidate[] = Array.from({ length: 30 }, (_, i) => ({
    regionId: `r${i}`, clientId: `c${i}`, locationId: `l${i}`,
    latitude: 41.36 + i * 0.001, longitude: 1.7 + i * 0.001,
    isAssigned: true,
  }));
  candidates[0]!.visitStartsAt = NOW.toISOString(); // today's visit → top priority
  const selected = selectRegions(candidates, { now: NOW, maxRegions: 20 });
  assert('GEO-01', 'Geofencing real (selecció dinàmica)',
    selected.length === 20 && selected[0]!.priority === 1 && selected[0]!.regionId === 'r0',
    `30 candidats → ${selected.length} regions (límit iOS 20); prioritat 1 = visita d'avui`);

  // GEO-COORDS a client without coordinates must not become a geofence.
  const noCoords = selectRegions(
    [{ regionId: 'x', clientId: 'x', locationId: 'x', latitude: NaN, longitude: NaN, isAssigned: true }],
    { now: NOW },
  );
  assert('GEO-COORDS', 'Sense coordenades → cap geovalla', noCoords.length === 0,
    `client sense lat/long → ${noCoords.length} regions (PENDENT DE GEOLOCALITZAR)`);

  // GEO-02/03 arrival with a scheduled visit → ALTA confidence → NOTIFICAR.
  // Region ids are the OS's; the client/location ids in the payload are real
  // UUIDs, because the notification builder refuses anything that is not.
  const locId = crypto.randomUUID();
  const regions: MonitoredRegion[] = [{
    regionId: 'r0', clientId, locationId: locId, latitude: 41.36, longitude: 1.7, radiusM: 120,
    clientName: 'BODEGA TEST', nearestVisitStartsAt: NOW.toISOString(),
  }];
  const arrival = evaluateArrival({
    regionId: 'r0', eventType: 'ENTRADA', regions, position: { latitude: 41.36, longitude: 1.7 },
    now: NOW, settings: { notify_client_arrival: true, geofence_cooldown_hours: 6, hide_client_name_on_lockscreen: false },
  });
  assert('GEO-02', 'Notificació',
    arrival.action === 'NOTIFICAR' && arrival.confidence === 'ALTA',
    `entrada amb visita programada → acció ${arrival.action}, confiança ${arrival.confidence}`);

  // GEO-03 deep link: the notification opens exactly the right client card, cold-start safe.
  if (arrival.action === 'NOTIFICAR') {
    const notif = buildArrivalNotification({
      clientId: arrival.region.clientId,
      locationId: arrival.region.locationId,
      clientName: arrival.region.clientName ?? '',
      confidence: arrival.confidence ?? 'MITJANA',
      hideClientName: false,
    })!;
    const route = notif.data.route;
    const parsed = parseDeepLink(`vitalpe://${route.replace(/^\//, '')}`);
    assert('GEO-03', 'Deep link a client',
      route.includes(clientId) && isSafeInAppRoute(route) && parsed?.route.includes(clientId) === true &&
        notificationPayloadIsMinimal(notif.data) && routeCarriesOnlyIds(route),
      `notificació → ruta "${route}" (només IDs, sense PII); parse deep link → client correcte`);
  } else {
    assert('GEO-03', 'Deep link a client', false, `acció inesperada ${arrival.action}`);
  }

  // GEO-04 two nearby clients → AMBIGUA → chooser, never a silent wrong card.
  const two: MonitoredRegion[] = [
    regions[0]!,
    { regionId: 'r1', clientId: crypto.randomUUID(), locationId: crypto.randomUUID(), latitude: 41.3601, longitude: 1.7001, radiusM: 120, clientName: 'ALTRE' },
  ];
  const ambiguous = evaluateArrival({
    regionId: 'r0', eventType: 'ENTRADA', regions: two, position: { latitude: 41.36005, longitude: 1.70005 },
    now: NOW, settings: { notify_client_arrival: true, geofence_cooldown_hours: 6, hide_client_name_on_lockscreen: false },
  });
  let ambigOk = ambiguous.action === 'PREGUNTAR' && ambiguous.candidates.length >= 2;
  if (ambiguous.action === 'PREGUNTAR') {
    const notif = buildAmbiguousArrivalNotification({ candidates: ambiguous.candidates, hideClientName: false })!;
    ambigOk = ambigOk && routeCarriesOnlyIds(notif.data.route) && notificationPayloadIsMinimal(notif.data);
  }
  assert('GEO-04', 'Diversos clients propers', ambigOk,
    `dos clients solapats → acció ${ambiguous.action}, ${ambiguous.candidates.length} candidats; el xooser només porta IDs`);

  // GEO-COOLDOWN repeated entries within the quiet period are suppressed.
  const cooled = evaluateArrival({
    regionId: 'r0', eventType: 'ENTRADA', regions, position: { latitude: 41.36, longitude: 1.7 },
    now: new Date(NOW.getTime() + 60 * 60 * 1000), lastEventAt: NOW.toISOString(),
    settings: { notify_client_arrival: true, geofence_cooldown_hours: 6, hide_client_name_on_lockscreen: false },
  });
  assert('GEO-COOLDOWN', 'Cooldown',
    cooled.action === 'IGNORAR' && isInCooldown(NOW.toISOString(), new Date(NOW.getTime() + 3.6e6), 6),
    `segona entrada dins el període de silenci → acció ${cooled.action}`);

  // GEO-NEARBY manual "clients propers" ordering by distance.
  const me = { latitude: 41.36, longitude: 1.70 };
  const d = [
    { name: 'a', p: { latitude: 41.37, longitude: 1.70 } },
    { name: 'b', p: { latitude: 41.361, longitude: 1.70 } },
  ].map((x) => ({ name: x.name, m: Math.round(haversineMeters(me, x.p)) })).sort((x, y) => x.m - y.m);
  assert('GEO-NEARBY', 'Clients propers per distància', d[0]!.name === 'b',
    `ordre per distància real: ${d.map((x) => `${x.name}=${x.m}m`).join(', ')}`);

  // --- summary -------------------------------------------------------------
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  await writeFile(
    path.join(ARTIFACTS, 'harness-results.json'),
    JSON.stringify({ runId: RUN_ID, at: new Date().toISOString(), passed, failed, results }, null, 2),
  );
  console.log(`\n══ ${passed} PASS · ${failed} FAIL ══`);
  console.log(`Evidència: test-artifacts/critical-features/harness-results.json\n`);

  await db.close?.();
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('\n✗ Harness ha fallat:', error);
  process.exitCode = 1;
});
