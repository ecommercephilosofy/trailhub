# VITALPE CRM

A commercial CRM for **Vitalpe**, a bulk wine and cava-base producer in the
Penedès. It replaces a set of Excel workbooks with one system that records who
the customers and prospects are, what they bought, what was agreed with them,
and what has to happen next — without ever inventing a fact that was not in the
sources.

The user interface is written in **Catalan**. The code, the comments and this
documentation are in English.

| Document | What it covers |
| --- | --- |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Layers, request path, where the rules live |
| [`DATA_MODEL.md`](DATA_MODEL.md) | Every table, constraint and derived view |
| [`SECURITY.md`](SECURITY.md) | Threat model, RLS, secrets, location, AI, retention |
| [`PERMISSIONS.md`](PERMISSIONS.md) | The ADMIN / GERENT / COMERCIAL matrix |
| [`DECISIONS.md`](DECISIONS.md) | Why the system is built the way it is |
| [`IMPORT_GUIDE.md`](IMPORT_GUIDE.md) | The import pipeline, end to end |
| [`ROUTING_AND_PROSPECTING.md`](ROUTING_AND_PROSPECTING.md) | The weekly route suggestion and the prospect queue |
| [`GOOGLE_CALENDAR_SETUP.md`](GOOGLE_CALENDAR_SETUP.md) | Google Cloud + OAuth + webhook |
| [`VOICE_AI_SETUP.md`](VOICE_AI_SETUP.md) | Transcription and interpretation providers |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | Supabase, Vercel, EAS, in order |
| [`TESTING.md`](TESTING.md) | What is tested and what is not |
| [`MANUAL_TEST_CHECKLIST.md`](MANUAL_TEST_CHECKLIST.md) | The things automation cannot prove |
| [`TRASPAS.md`](TRASPAS.md) | **Posar el CRM al teu ordinador** — guia per a Carlos, i què costa diners |
| [`CLAUDE.md`](CLAUDE.md) | Standing instructions for AI coding sessions |

---

## 1. Who uses it

Vitalpe has **one** commercial. This is his working tool, and the second role is
the person he reports to — who watches, and writes nothing.

| Role | Who | What they do |
| --- | --- | --- |
| `ADMIN` | The commercial | Works the whole portfolio and administers the system: users, roles, invitations, imports, duplicate decisions, product catalogue. |
| `GERENT` | His superior | **Read only.** Lands on `/supervisio`: activity done, visits made with their objective and observations, what was closed, what is overdue, which companies have gone quiet. Cannot write to any table. |
| `COMERCIAL` | A second rep, if there ever is one | Works their assigned companies: calls, visits, samples, offers. Records what happened. |

The role is a **preset evaluated in the database**, not a set of hidden buttons.
The supervisor's writes fail at the row-level policy, not in the interface.
See [`PERMISSIONS.md`](PERMISSIONS.md).

---

## 2. What it is made of

```
apps/
  web/          Next.js 16 (App Router, React 19, server actions, Tailwind 4)
  mobile/       Expo / React Native — declared, sources not in the repo yet
packages/
  types/        TypeScript mirror of the SQL enums and row shapes
  validation/   zod schemas (the friendly first line; SQL remains the authority)
  domain/       pure business rules, several of them twins of SQL functions
  config/       environment loading/validation + AES-256-GCM secret box
  integrations/ Google Calendar, voice transcription/interpretation, geocoding
scripts/
  import/       the real import pipeline for the supplied Excel/PDF sources
  maintenance/  local Postgres harness (PGlite)
supabase/
  migrations/   8 SQL files: 42 tables, 2 views, 69 RLS policies, 36 app.* functions
  seed.sql      master data: workspace, 42 products, 4 campaigns, product aliases
  tests/        SQL-level suites: RLS, domain rules, SQL↔TypeScript parity
docs/imports/   generated import reports (one dated folder per run)
```

Package manager: **pnpm 10** workspaces. Node **≥ 20.11**.

---

## 3. Prerequisites

| Requirement | Notes |
| --- | --- |
| Node ≥ 20.11 | `engines` in the root `package.json` |
| pnpm 10.33 | `packageManager` field; `corepack enable` is enough |
| Nothing else | No Docker, no Postgres server, no cloud account needed to run the tests or the local database |

Docker is **not** required. Supabase's local stack needs it, so where it is
unavailable the migrations run against **PGlite** (PostgreSQL 17 compiled to
WebAssembly) instead. See [`DECISIONS.md` → *Local database*](DECISIONS.md#2-local-database-pglite-instead-of-docker).

---

## 4. Install

```bash
pnpm install
```

---

## 5. Run with no credentials at all

This is the supported path, not a degraded one.

### 5.1 Apply the schema to a throwaway database

```bash
pnpm db:local
```

Applies the 8 migrations plus `supabase/seed.sql` to an in-memory PGlite
instance, prints what was created, and **fails with a non-zero exit code if any
public table is missing row level security**. Current output:

```
Tables: 42
Views: 2  (v_client_derived, v_client_geo_status)
Tables with RLS enabled: 42
RLS policies: 69
app.* functions: 36
Seeded products: 42, campaigns: 4
✓ Every public table has row level security enabled.
```

This is a smoke test: it does not persist anything.

### 5.2 Load the real commercial data into a persistent local database

```bash
pnpm import:local -- --fresh
```

With `DATABASE_URL` unset the importer writes to a persistent PGlite database in
`.data/crm` (git-ignored), creates the three local role users
(`admin@vitalpe.local`, `gerencia@vitalpe.local`, `carlos.escobar@vitalpe.local`),
runs the eight import phases and writes a dated report folder under
`docs/imports/`.

Flags:

| Flag | Effect |
| --- | --- |
| `--fresh` | Delete `.data/crm` and start from an empty database |
| `--owner=<email>` | Assign the imported companies to this profile (default `carlos.escobar@vitalpe.local`) |
| `--dry-run` | Run everything inside one transaction and roll it back |

### 5.3 Start the web app

```bash
pnpm dev          # → http://localhost:3004
```

With `DATABASE_URL` unset the web app opens the same `.data/crm` PGlite
database. Sign in at `/entrar` with one of the seeded local users; the session
is a signed, HttpOnly cookie and **every query still runs through RLS as that
user** — the local path is not a bypass. See
[`ARCHITECTURE.md`](ARCHITECTURE.md#3-the-request-path).

> The dev server listens on **3004**, not 3000. `.env.example` still shows
> `http://localhost:3000`; adjust `NEXT_PUBLIC_APP_URL` and
> `GOOGLE_REDIRECT_URI` accordingly if you set them.

---

## 6. Run against Supabase

1. Create a Supabase project.
2. Push the migrations and the seed — see [`DEPLOYMENT.md`](DEPLOYMENT.md).
   `supabase/config.toml` does not exist in this repo yet, so `supabase db push`
   needs `supabase init` + `supabase link` first.
3. Set at least:

```bash
DATABASE_URL=postgres://…            # the app's data layer connects directly
NEXT_PUBLIC_SUPABASE_URL=…
NEXT_PUBLIC_SUPABASE_ANON_KEY=…
SUPABASE_SERVICE_ROLE_KEY=…          # server only
APP_ENCRYPTION_KEY=…                 # openssl rand -base64 48
NEXT_PUBLIC_APP_URL=https://…
```

4. `pnpm build && pnpm --filter @vitalpe/web start`.

Everything else (Google Calendar, voice, geocoding, push, Sentry) is optional
and degrades to a local implementation when absent — see
[`VOICE_AI_SETUP.md`](VOICE_AI_SETUP.md) and
[`GOOGLE_CALENDAR_SETUP.md`](GOOGLE_CALENDAR_SETUP.md).

---

## 7. Commands

These are the scripts in the root `package.json`. The **Works** column is the
state actually observed on 2026-07-23.

| Command | What it does | Works |
| --- | --- | --- |
| `pnpm dev` | Web app on port 3004 | yes |
| `pnpm build` | `next build` of the web app | yes |
| `pnpm test` | Full vitest run (669 tests) | yes |
| `pnpm test:watch` | vitest in watch mode | yes |
| `pnpm db:local` | Migrations + seed on throwaway PGlite, asserts RLS | yes |
| `pnpm import:local` | Full import of `data/sources/` into `.data/crm` | yes |
| `pnpm import:run -- --remote` | The same import against the hosted database | yes |
| `pnpm typecheck` | `tsc -b tsconfig.build.json` | **no — `tsconfig.build.json` does not exist** |
| `pnpm lint` | `eslint .` | **no — no ESLint flat config in the repo** |
| `pnpm db:seed` | `scripts/maintenance/seed.ts` | **no — file does not exist** |
| `pnpm import:inspect` | `scripts/import/inspect.ts` | **no — file does not exist** |
| `pnpm import:verify` | `scripts/import/verify.ts` | **no — file does not exist** |
| `pnpm export:data` | `scripts/export/export.ts` | **no — file does not exist** |
| `pnpm test:e2e` | `playwright test` in `apps/web` | **no — no `playwright.config.ts`** |
| `pnpm dev:mobile` | `expo start --dev-client` | only once `apps/mobile` has sources |
| `pnpm supabase:start` / `db:migrate` / `db:reset` | Supabase CLI | needs `supabase init`/`link` first |

Type checking today is done by `next build` (`typescript.ignoreBuildErrors` is
`false` in `apps/web/next.config.mjs`) and by vitest's transform.

---

## 8. The data that is already in it

`pnpm import:run` was executed against the eight supplied source files. The run
reconciles exactly:

```
2 491 rows read = 2 367 imported + 36 ignored + 22 rejected + 66 excluded
```

| Produced | Count |
| --- | ---: |
| Canonical companies | 802 |
| Aliases | 836 |
| Contacts | 479 |
| Locations | 461 |
| Opportunities | 177 |
| Delivery notes | 443 |
| Activities | 36 |
| Tasks | 76 |
| Verifications | 97 |
| Duplicate candidates awaiting a human | 174 |
| Automatic merges | 0 |

Excluded and parked in `excluded_records` (never deleted): **2** Bag in Box
lines, **40** by-product lines (BRISA / MARES), **24** delivery-note lines whose
product is not in the catalogue.

Full detail: `docs/imports/2026-07-23/` and [`IMPORT_GUIDE.md`](IMPORT_GUIDE.md).

---

## 9. Testing

```bash
pnpm test
```

**636 tests across 27 files, all passing.** Among them: 21 RLS tests, 58 SQL
domain tests and 27 SQL↔TypeScript parity tests, all running against real
migrations on PGlite. See [`TESTING.md`](TESTING.md).

Two real defects were found by these tests and fixed:

1. `app.complete_task` wrote commercial history even when RLS blocked the task
   from being closed. It now checks that the `UPDATE` actually matched a row and
   raises `SENSE_PERMIS_PER_TANCAR_TASCA` otherwise.
2. Google OAuth token columns stayed readable because a column-level `REVOKE`
   cannot subtract from a table-level `GRANT`. Fixed by revoking the table grant
   and re-granting column by column, deliberately omitting `access_token_enc`,
   `refresh_token_enc` and `sync_token`.

---

## 10. Current state — honest

### Complete and proven by tests

- **Database schema**: 41 tables, 2 views, 65 RLS policies, 35 `app.*`
  functions, 6 migrations. Applies cleanly; every public table has RLS.
- **Domain rules**: classification engine (twice — PL/pgSQL and TypeScript, kept
  in step by a shared fixture table), task rules, dedupe scoring, geofence
  selection and arrival confidence, date parsing, normalisation.
- **Import pipeline**: reads the eight real sources, reconciles exactly, parks
  what it cannot map, queues doubtful duplicates, merges nothing automatically,
  and generates five report files.
- **Integrations as libraries**: Google Calendar adapter (OAuth, events, watch
  channels, incremental sync), a fully functional local calendar provider, a
  loop-free reconciliation engine, OpenAI Whisper transcription, Anthropic
  interpretation with a deterministic local fallback, Google geocoding with a
  "never invent coordinates" null provider, log redaction, AES-256-GCM secret box.
- **`packages/config`**: environment validation and a per-integration status
  report in Catalan for the admin screen.

### Partial / in progress

- **Web app.** The data layer, auth, formatting and the server actions for
  clients, contacts, locations, opportunities, activities, tasks, visits,
  calendar, voice, users and admin exist. The navigation in
  `apps/web/src/app/(app)/layout.tsx` lists `INICI`, `CLIENTS`, `CALENDARI`,
  `TASQUES`, `REGISTRE` and seven `ADMINISTRACIÓ` entries; **not all of those
  routes have a page yet**. The app surface is being built and changes daily —
  check `PROGRESS.md` for the live status rather than trusting a list here.
- **Field-level provenance.** `public.field_provenance` exists, is indexed and is
  RLS-protected, and the importer has a `prov()` helper and a `flushProvenance()`
  writer — but **`prov()` is never called**, so the table is empty (the generated
  `IMPORT_REPORT.md` says `Registres de procedència: 0`). Row-level provenance
  *is* recorded: `import_files.sha256`, `import_rows.raw`,
  `import_rows.entities_created`, `import_rows.outcome_reason`.
- **Tooling scripts.** `typecheck`, `lint`, `db:seed`, `import:inspect`,
  `import:verify`, `export:data` and `test:e2e` are declared but not backed by
  files or configuration (see §7).
- **Mobile app.** `apps/mobile/package.json` declares the full Expo dependency
  set (expo-location, expo-task-manager, expo-notifications, expo-audio,
  expo-secure-store, expo-router). No application sources are in the repo yet.
- **Undo of an import.** The schema supports it (`imports.undone_at`,
  `import_rows.entities_created`, `client_merges.snapshot`) but no script or UI
  performs it. See [`IMPORT_GUIDE.md` → *Undo*](IMPORT_GUIDE.md#8-undoing-an-import).

### Needs external credentials to exercise

| Feature | Without credentials | With credentials |
| --- | --- | --- |
| Google Calendar | `LocalCalendarProvider` — a real implementation with ETags, sync tokens and watch channels, persisted to JSON | Two-way sync with a real Google account |
| Voice transcription | Paste the transcript by hand; the rest of the flow is identical | OpenAI Whisper |
| Voice interpretation | Deterministic rule-based interpreter (`LocalInterpreter` / `quickCapture`) | Anthropic model |
| Geocoding | Addresses stay `PENDENT DE GEOLOCALITZAR`; coordinates are never invented | Google Geocoding |
| Push notifications | In-app only | Expo push |
| Error tracking | Server log only | Sentry |

### Known issues worth fixing

- **Transaction affinity on the hosted backend.** `apps/web/src/lib/db.ts`
  issues `begin`, `set local role authenticated` and `set_config(...)` as
  separate `postgres.js` calls against a pool of 5 connections. postgres.js does
  not pin a pooled connection across independent queries, so under concurrency
  the role/JWT context is not guaranteed to apply to the statements that follow.
  On PGlite (a single connection) it is correct. Use `sql.begin()` or a reserved
  connection before running the app against a real Postgres under load.
- Scratch files `zz-inspect.mts`, `zz-rls.mts`, `zz-rls2.mts` are still in the
  repository root and are not referenced by anything.
- `data/sources/` holds the real, unredacted commercial source files and is not
  git-ignored.
