# CRITICAL FEATURES AUDIT

Functional audit of the three critical features, run against the real code and a
real (throwaway) database — not by reading file names. Every claim below is
backed by an executed test whose output lives in
[`test-artifacts/critical-features/`](test-artifacts/critical-features/).

- Date: 2026-07-25
- Method: real library code + real SQL exercised by
  [`scripts/test-critical-features.ts`](scripts/test-critical-features.ts)
  against a throwaway in-memory PGlite (seeded, migrated); plus live read-only
  checks against production and inspection of the wiring.
- Harness result: **20 PASS · 0 FAIL** — [`harness-results.json`](test-artifacts/critical-features/harness-results.json),
  [`harness-run.log`](test-artifacts/critical-features/harness-run.log).

## Environment (what is actually configured)

`.env.local` holds only the six core variables: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`,
`NEXT_PUBLIC_APP_URL`, `APP_ENCRYPTION_KEY`. Therefore:

| Capability | Credential | Present? | Consequence |
| --- | --- | :---: | --- |
| Audio transcription | `OPENAI_API_KEY` | ❌ | Real transcription **blocked**; local path keeps the recording and accepts a pasted transcript. |
| Free-language interpretation | `ANTHROPIC_API_KEY` | ❌ | Deterministic local interpreter is used (real, but single-action). |
| Google Calendar | `GOOGLE_CLIENT_ID/SECRET/…` | ❌ | Real Google sync **blocked**; the loop-free engine runs against the local provider. |

None of these crashes the app: each degrades to a working local implementation.

## Baseline gates

| Gate | Result |
| --- | --- |
| `pnpm test` | 647 pass |
| `pnpm typecheck` | pass (repo) |
| `pnpm lint` | 1 pre-existing warning (`scripts/import/db.ts:61`) |
| `pnpm build` | pass (web) |
| `apps/mobile` typecheck/build | **cannot run** — Expo dependencies not installed (`node_modules` empty) |
| `apps/mobile` logic tests | 18 pass (deep links) |

A real fix was made here: `tsconfig.json` was missing the bare
`@vitalpe/integrations` path mapping (every other package had one), which broke
resolution outside Next. Added.

---

## Feature 1 — Voice notes → transcription → actions

**Status: FUNCIONA PARCIALMENTE.**
The capture → preview → confirm → apply pipeline is real and complete and the
apply path handles every action type. The two gaps are (a) real audio
transcription needs a credential, and (b) the *local* interpreter extracts a
single action from a multi-action sentence — the multi-action case is what the
Anthropic interpreter is for.

**Architecture (real):** audio uploaded to the private Supabase bucket
`notes-de-veu` (25 MB / server-side cap; signed URLs); transcription via
`OpenAIWhisperProvider` or the local fallback; interpretation via
`AnthropicInterpreter` or `LocalInterpreter`; the model **only proposes** —
`applyProposal` consumes a closed action list, in one transaction, guarded by an
idempotency key and an `applied_at` check, with audit and retention. Dangerous
actions (delete/merge company, confirm classification, invite users) have no
branch in the apply switch — they are unrepresentable, not merely rejected.

**Tested (evidence: `harness-results.json`, `voice-interpretation.json`):**

- VOZ-02 — no `OPENAI_API_KEY`: local provider returns `NOT_CONFIGURED` with a
  clear message and keeps the audio → **blocked by credentials**, handled
  gracefully.
- VOZ-03 — the real `LocalInterpreter` reads the canonical note and returns a
  validated proposal (1 action, `REGISTRAR_ACTIVITAT`, 90% confidence).
- VOZ-04 — applying a validated proposal via the exact server-action SQL creates
  1 activity, 2 tasks (the call + a visit's twin task) and 1 visit, **all on the
  correct client**.
- VOZ-06 — the task lands at `2026-10-05 10:30 Europe/Madrid`, priority `ALTA`.
- VOZ-05 — a double confirm of the same proposal yields **1** row (unique
  `(workspace_id, idempotency_key)`).
- VOZ-AMB — "a principis del mes que ve" produces an **ambiguity**, not a
  silently invented date.

**Limitation:** with the local interpreter, "crea una tasca… i programa una
visita…" in one utterance yields one action, not three. This is documented, not
hidden: the free-language multi-action path is `ANTHROPIC_API_KEY`'s job. The
apply pipeline itself handles all action types (proven by VOZ-04).

**Not exercised end-to-end here:** the browser MediaRecorder capture and the
mobile recorder (no device; mobile app has no runnable UI — see Feature 2).

---

## Feature 2 — Arrival detection at a client

**Status: FUNCIONA PARCIALMENTE (logic) / BLOQUEADO POR LIMITACIÓN DE PLATAFORMA
(real device).**

**Architecture (real but incomplete):** `apps/mobile` is a configured Expo
project — `expo-location`, `expo-task-manager` (background geofencing),
`expo-notifications`, deep links declared three ways (custom scheme + iOS
associated domains + Android App Links), background modes in `app.config.ts`.
The hard logic exists and is unit-tested in `apps/mobile/src/core/` and
`packages/domain/src/geofence.ts`. **But there is no `app/` directory** (no
expo-router screens) and the Expo dependencies are not installed, so the mobile
app **cannot be built or run** as-is. Real on-device background geofencing is
therefore not deployable from this repository today.

**Tested (evidence: `harness-results.json`) — the domain + mobile core:**

- GEO-01 — 30 candidates → exactly 20 monitored regions (iOS cap), priority 1 =
  today's visit. Dynamic selection, not "monitor everything".
- GEO-COORDS — a client with no coordinates yields **0** regions (never an
  invalid geofence; stays `PENDENT DE GEOLOCALITZAR`).
- GEO-02 — entering a region with a scheduled visit → `NOTIFICAR`, confidence
  `ALTA`.
- GEO-03 — the notification's deep link is `/clients/<uuid>`; it parses back to
  the correct client, is a safe in-app route, and the payload carries **only
  IDs** (no client name / PII) — cold-start safe.
- GEO-04 — two overlapping clients → `PREGUNTAR` (the chooser), never a silent
  wrong card; the chooser route carries only IDs.
- GEO-COOLDOWN — a second entry inside the quiet period → `IGNORAR`.
- GEO-NEARBY — `CLIENTS PROPERS` distance ordering is correct (real haversine);
  the web client card exposes it (`clients/[id]/page.tsx`).

**Privacy (verified in code):** notification `data` is machine-checked minimal
(`notificationPayloadIsMinimal`), lock-screen name hiding is supported, and no
continuous track is stored (only discrete arrival events).

**Blocked / needs a device:** foreground/background/cold-start behaviour with the
app closed, real OS geofence delivery, permission prompts. Checklist in
[`docs/MOBILE_SETUP.md`](docs/MOBILE_SETUP.md). To make this runnable: add the
`app/` expo-router screens, `pnpm --filter @vitalpe/mobile install`, then an EAS
development build on a physical phone.

---

## Feature 3 — Calendar with bidirectional Google sync

**Status: FUNCIONA COMPLETAMENTE (engine + DB apply, local provider) /
BLOQUEADO POR CREDENCIALES (real Google account).**

The reconciliation is genuinely bidirectional, loop-free and idempotent, and the
DB side applies pulls to the visit **and** its linked task. Only the live Google
transport is unproven, for lack of a Google credential.

**Architecture (real):** `reconcile()` in `@vitalpe/integrations` is a pure,
loop-free state machine (cancellation → cancel visit; converged hashes → NOOP,
which kills echo loops; push; pull; last-write-wins; conflict report). The web
`sync-engine.ts` wires it to the DB (`pushVisit`, `pullChanges`,
`applyRemoteToCrm` updating visit + task, `cancelFromGoogle`). OAuth requests
`calendar.events` (+ `calendar.app.created` for a dedicated calendar),
`access_type=offline` + `prompt=consent` for refresh tokens, which are sealed
with AES-256-GCM and column-revoked. The webhook validates
`X-Goog-Channel-Token` in constant time, rejects unknown channels, dedupes on
`(channelId, messageNumber)`, and runs an incremental sync with the stored
`syncToken`.

**Tested (evidence: `harness-results.json`) — the real engine + real SQL:**

- CAL-01 — visits persist with client, time, duration and a linked task.
- CAL-02 — a new visit → `CREATE_REMOTE` (CRM → Google).
- CAL-03 — Google moves the time → `APPLY_TO_CRM` (Google → CRM).
- CAL-04 — a pulled change updates **both** the visit (12:00) and its linked
  task (12:00, 90 min): the card's next-visit follows automatically.
- CAL-05 — identical sides → `NOOP` (`ALREADY_CONVERGED`): **no echo loop**.
- CAL-06 — cancelled in Google → `CANCEL_VISIT_IN_CRM` (never deleted).
- CAL-IDEM — re-processing the same notification → `NOOP` (idempotent).

**Blocked / needs Google credentials:** the live OAuth round-trip, real webhook
delivery, channel renewal, and token-revocation UX. The engine that consumes
them is proven; what is unproven is the Google transport. Set `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (+ `GOOGLE_CALENDAR_WEBHOOK_URL`
for instant push) — see [`GOOGLE_CALENDAR_SETUP.md`](GOOGLE_CALENDAR_SETUP.md) —
then connect a **test** Google calendar and re-run Prueba 1–15.

---

## E2E-01 — Combined flow

The combined flow (client → visit → Google → arrival → voice → confirm) is
covered piecewise: the calendar half is proven by CAL-*, the arrival half by
GEO-*, the voice half by VOZ-*. It is **not** proven as one live click-through
because the two ends that need external accounts (Google, a phone) are blocked.
The DB-level combined slice (create visit + task → apply a remote time change →
both follow) is exercised in CAL-04.

---

## Final matrix

| ID | Requisito | Estado inicial | Cambios realizados | Prueba ejecutada | Evidencia | Estado final |
| --- | --- | --- | --- | --- | --- | --- |
| VOZ-01 | Grabar desde ficha | Web sí, móvil sin UI | — | Componente web presente; captura de audio no ejercitada sin micrófono/dispositivo | `apps/web/src/components/registre/` | IMPLEMENTADO PERO NO PROBADO (captura) |
| VOZ-02 | Transcribir | Local fallback | — | Harness VOZ-02 | `harness-results.json` | BLOQUEADO POR CREDENCIALES (OpenAI) |
| VOZ-03 | Previsualizar acciones | Real | — | Harness VOZ-03 | `voice-interpretation.json` | FUNCIONA COMPLETAMENTE |
| VOZ-04 | Crear tareas y notas | Real | — | Harness VOZ-04/06 (SQL real) | `harness-results.json` | FUNCIONA COMPLETAMENTE |
| VOZ-05 | Evitar duplicados | Real | — | Harness VOZ-05 | `harness-results.json` | FUNCIONA COMPLETAMENTE |
| VOZ-MULTI | Varias acciones en una nota | Local: 1 acción | Documentado | Harness VOZ-03 | `voice-interpretation.json` | FUNCIONA PARCIALMENTE (LLM real lo cubre) |
| GEO-01 | Geofencing real (selección) | Real (lógica) | — | Harness GEO-01/COORDS | `harness-results.json` | FUNCIONA COMPLETAMENTE (lógica) |
| GEO-02 | Notificación | Real (lógica) | — | Harness GEO-02 | `harness-results.json` | FUNCIONA COMPLETAMENTE (lógica) |
| GEO-03 | Deep link a cliente | Real | — | Harness GEO-03 + 18 tests deepLinks | `harness-results.json` | FUNCIONA COMPLETAMENTE (lógica) |
| GEO-04 | Varios clientes cercanos | Real | — | Harness GEO-04 | `harness-results.json` | FUNCIONA COMPLETAMENTE (lógica) |
| GEO-05 | Funcionamiento en segundo plano | Sin app ejecutable | — | No ejecutable (sin `app/`, sin device) | `apps/mobile/` | BLOQUEADO POR LIMITACIÓN DE PLATAFORMA |
| CAL-01 | Calendario interno | Real | — | Harness CAL-01 | `harness-results.json` | FUNCIONA COMPLETAMENTE |
| CAL-02 | CRM → Google | Real (engine) | — | Harness CAL-02 | `harness-results.json` | FUNCIONA COMPLETAMENTE (engine); Google real bloqueado |
| CAL-03 | Google → CRM | Real (engine) | — | Harness CAL-03 | `harness-results.json` | FUNCIONA COMPLETAMENTE (engine); Google real bloqueado |
| CAL-04 | Actualizar ficha y tarea | Real | — | Harness CAL-04 (SQL real) | `harness-results.json` | FUNCIONA COMPLETAMENTE |
| CAL-05 | Evitar bucles y duplicados | Real | — | Harness CAL-05/IDEM | `harness-results.json` | FUNCIONA COMPLETAMENTE |
| CAL-06 | Cancelación | Real | — | Harness CAL-06 | `harness-results.json` | FUNCIONA COMPLETAMENTE |
| E2E-01 | Flujo completo combinado | Piezas reales | — | CAL-04 (slice DB) + piezas | `harness-results.json` | FUNCIONA PARCIALMENTE (extremos bloqueados) |

---

## Data protection & cleanup

- All mutating tests run against a **throwaway in-memory PGlite**. Production and
  `.data/crm` are never written. Confirmed: `pnpm test:critical:cleanup` finds
  **0** test rows in `.data/crm`.
- Every test record is tagged `E2E-CRITICAL-AUDIT-<timestamp>`.
- [`scripts/cleanup-critical-feature-tests.ts`](scripts/cleanup-critical-feature-tests.ts)
  sweeps tagged rows from a persisted database if the harness is ever pointed at
  one; dry-run by default, refuses the hosted DB without `--remote`, never
  touches `audit_log`.
- The harness is idempotent: it seeds a fresh database each run.

## Real risks (not hidden)

1. **Mobile app is not runnable.** The geofencing/deep-link/arrival *logic* is
   complete and tested, but without `app/` screens, installed Expo deps and a
   device, on-device background arrival cannot be claimed to work. This is the
   single biggest gap.
2. **Real transcription and real Google sync are unproven** for lack of
   credentials. The code paths that consume them are proven with local
   providers; the cloud transports are not.
3. **Local interpreter is single-action.** Multi-action voice notes need
   `ANTHROPIC_API_KEY`.
4. **Voice audio retention** deletes on confirm, but there is **no scheduled
   purge** for recordings of notes that are never confirmed. `retention.ts` has
   the policy; a cron is not wired in this repo.

## Configuration pending (external)

| To unblock | Set | Where |
| --- | --- | --- |
| Real transcription | `TRANSCRIPTION_PROVIDER=openai`, `OPENAI_API_KEY` | Vercel env |
| Multi-action / free-language voice | `ANTHROPIC_API_KEY` | Vercel env |
| Real Google Calendar | `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI` (+ `GOOGLE_CALENDAR_WEBHOOK_URL`) | Vercel env + Google Cloud |
| Runnable mobile app | add `app/` expo-router screens, install Expo deps, EAS dev build | `apps/mobile` |
