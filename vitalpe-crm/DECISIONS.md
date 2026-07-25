# DECISIONS

Every entry is a decision that was actually taken in this repository, with the
reason and the cost. Where a decision has a known limit, the limit is stated.

---

## 1. Monorepo, pnpm workspaces, no build step for shared packages

**Decision.** One repository: `apps/web`, `apps/mobile`, and five shared packages
under `packages/`. The packages publish their `src/index.ts` directly
(`"main": "./src/index.ts"`), and the consumers resolve them through TypeScript
`paths` plus a vitest `resolve.alias`. There is no `dist/`, no `tsc -b` in the
inner loop.

**Why.** The same business rule has to run in three places — a React server
component, an Expo screen with no network, and inside PostgreSQL. Splitting the
rules into published packages would add a build step to every edit and let the
web app and the phone drift onto different versions of the same rule. A single
workspace makes "the phone and the browser disagree" impossible by construction.

**Cost.** Next.js needs `experimental.externalDir: true` to compile TypeScript
from outside `apps/web`. Consumers must keep their `paths` in step (root
`tsconfig.json`, `apps/web/tsconfig.json`, `vitest.config.ts` — three places).
`@vitalpe/integrations` is only mapped as `@vitalpe/integrations/*`, so imports
must be written as `@vitalpe/integrations/calendar/index`, not
`@vitalpe/integrations/calendar`.

---

## 2. Local database: PGlite instead of Docker

**Decision.** The local and CI database is **PGlite** — PostgreSQL 17 compiled to
WebAssembly — driven by `scripts/maintenance/pglite.ts`. A small shim recreates
the parts of the Supabase platform the schema depends on: the `auth` schema,
`auth.users`, `auth.uid()`, `auth.role()`, and the `anon` / `authenticated` /
`service_role` roles (the last one with `bypassrls`).

**Why.** `supabase start` requires Docker, which is not available on this
machine, and is slow in CI. Without a real Postgres there is no way to prove that
RLS actually blocks anything — a test suite that "passes" because no policy was
ever evaluated proves nothing.

**What this does prove.**

- The migrations apply, in order, to a real PostgreSQL 17 engine.
- Every constraint, generated column, trigger, enum and function behaves as
  written.
- RLS is genuinely enforced: `asUser()` opens a transaction, sets
  `request.jwt.claim.sub`, and does `SET LOCAL ROLE authenticated` — exactly the
  context PostgREST establishes. The transaction is not optional: `SET LOCAL` and
  `set_config(..., true)` are transaction-scoped and would silently do nothing
  outside one.
- Column-level `GRANT`/`REVOKE` behaves as on the server (this is how the OAuth
  token leak was caught).

**What this does not prove.**

- Anything about Supabase Auth itself: JWT verification, refresh tokens, the
  hosted `auth.users` schema, e-mail flows. `auth.uid()` here reads a GUC.
- PostgREST's own behaviour: schema exposure, `Accept-Profile`, embedded
  resources, its `role` switching.
- Supabase Storage, Realtime, Edge Functions.
- Extensions that are not compiled into PGlite. Only `pg_trgm` is loaded, which
  is why the schema deliberately needs nothing else.
- Performance, planner behaviour at real volume, connection pooling.

**Consequence.** A hosted deployment must still be smoke-tested by hand — see
[`MANUAL_TEST_CHECKLIST.md`](MANUAL_TEST_CHECKLIST.md).

---

## 3. The web app talks to Postgres directly, not through PostgREST

**Decision.** `apps/web/src/lib/db.ts` opens a Postgres connection
(`postgres.js` when `DATABASE_URL` is set, PGlite otherwise) and runs every
user-facing query inside a transaction that begins with:

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', $user_id, true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
```

**Why.** Three reasons.

1. It is the *same* security context PostgREST establishes, so RLS remains the
   single boundary and the RLS test suite is testing the real thing.
2. The domain lives in `app.*` functions and in views with lateral joins. Driving
   those through PostgREST means either exposing the `app` schema (which the
   design refuses) or a proliferation of thin RPC wrappers.
3. It lets the whole application run against PGlite with no network and no
   credentials, which is what makes the "run it with nothing configured" promise
   real.

**Cost and known limit.** The session context is per-transaction, so the
transaction and its statements must run on the **same** connection.
`postgres.js` does not pin a pooled connection across independent `sql.unsafe()`
calls, and `db.ts` currently issues `begin`, `set local role` and the queries as
separate calls against a pool of five. On PGlite (one connection) this is
correct; against a real Postgres under concurrency it is not guaranteed.
Switching `withUser`/`withServiceRole` to `sql.begin()` or a reserved connection
is required before the hosted backend takes real traffic. This is recorded here
rather than hidden because it is the one place where the abstraction is not yet
honest.

Also: `set_config('app.origin' | 'app.device' | 'app.correlation_id', …, true)`
in the same transaction is what lets `app.audit_trigger()` record *where* a
change came from without every table carrying those columns.

---

## 4. An `app` schema for RLS helpers, and why they are SECURITY DEFINER

**Decision.** Enums, RLS helpers and domain functions live in schema `app`, which
is never added to PostgREST's exposed schema list. `app.role_in`,
`app.is_member`, `app.is_admin`, `app.is_manager` and `app.can_edit_client` are
`SECURITY DEFINER` with `set search_path = public, app, pg_temp`.

**Why SECURITY DEFINER.** The policy on `workspace_memberships` has to ask "is
this user a member of this workspace?", which is a `SELECT` on
`workspace_memberships` — the very table being protected. As an invoker-rights
function that re-enters RLS and recurses. Running as the definer breaks the loop.
The fixed `search_path` is what stops a caller from shadowing `public` with a
temp schema and hijacking the definer's privileges.

**Why a separate schema at all.** `public` is the API surface. Anything in `app`
is, by construction, unreachable from a client even if a future migration
forgets a `REVOKE`. `grant usage on schema app to authenticated` is granted, and
execute is granted **function by function** for the eight operations users are
allowed to call; `app.merge_clients`, `app.audit_trigger` and
`app.handle_new_user` have execute explicitly revoked from `public`, `anon` and
`authenticated`.

---

## 5. Enums for closed sets, master tables for open ones

**Decision.** Sets that application code branches on are PostgreSQL enums in
`app` (`user_role`, `classification`, `activity_result`, `task_status`,
`commercial_action`, …). Sets that the business will extend are ordinary tables
(`client_types`, `products`, `product_aliases`, `campaigns`).

**Why.** An enum gives the strongest guarantee: an impossible value cannot be
stored, and every `switch` in TypeScript is exhaustively checkable against
`packages/types/src/enums.ts`. That is exactly what you want for
"`ACTIU SEGUR | POTENCIAL INTERESSAT | POTENCIAL AMB UN ALTRE PROVEIDOR | NO
POTENCIAL`", where adding a fifth value is a product decision that must touch
code anyway. It is exactly what you do *not* want for a product catalogue, where
adding a row is Tuesday.

**Cost.** Adding an enum label needs a migration (`ALTER TYPE ... ADD VALUE`,
which cannot run inside a transaction block on older servers). Accepted.

### 5.1 Company type is a table, not an enum

The brief says "start with `EMBOTELLADOR`, `ELABORADOR`, `COOPERATIVA`, `ALTRES`
and let it grow". `public.client_types` is therefore a table with `code`,
`label`, `sort_order`, `is_active` and `requires_explanation`. `ALTRES` carries
`requires_explanation = true`, and the rule is enforced independently by the
`clients_other_type_needs_explanation` CHECK — so the flag can drive the UI
without the UI being the enforcement.

Growth without a schema rewrite was the whole point. `clients.client_type_code`
is a plain FK; adding a fifth type is one `INSERT`.

---

## 6. Accent folding with `translate()`, not the `unaccent` extension

**Decision.** `app.unaccent_ca(text)` is an explicit `translate()` over the
Catalan / Spanish / French accented characters, declared `IMMUTABLE`.

**Why.** The single-argument `unaccent(text)` is **STABLE**, not `IMMUTABLE`,
because it resolves its dictionary through the current search path at call time.
A STABLE function cannot back a generated column (`clients.name_norm`,
`contacts.phone`, `client_aliases.alias_norm`) nor an index. Those generated
columns are the dedupe keys and the search keys, so the choice was: no generated
columns, or no `unaccent`. The extension also puts the function in whichever
schema it was installed into, which makes migrations environment-dependent.

**Cost.** The mapping is a literal pair of strings whose character-by-character
alignment *is* the mapping. It is duplicated in
`packages/domain/src/normalize.ts` (`UNACCENT_FROM` / `UNACCENT_TO`) and covered
by `normalize.test.ts`. Do not "tidy" either string. Characters outside the pair
are left as-is; a character in `from` with no counterpart in `to` would be
deleted, which is PostgreSQL's `translate()` semantics and is reproduced exactly.

**Note.** Only `pg_trgm` is installed. `gen_random_uuid()` is core since PG13, so
`pgcrypto` is not needed either. Keeping the extension list to one is what lets
the whole schema run on PGlite.

---

## 7. `normalize_company` alternation ordering: POSIX vs JavaScript

**Decision.** `app.normalize_company` strips legal forms
(`SL`, `S.L.`, `SA`, `SCCL`, `SCP`, `SAT`, `CB`, `societat limitada`, …) so
`MASIA ROMAGOSA S.L.` and `Masia Romagosa SL` collapse to the same key. The
TypeScript twin sorts the same alternatives **longest-first** before building the
regular expression.

**Why.** PostgreSQL's regex engine resolves an alternation by the POSIX
*longest-match* rule; JavaScript resolves it *leftmost-first*. Given the same
alternation written in the same order, the two engines can pick different
alternatives and produce different keys — and these keys back a unique index. The
alternatives are all followed by the same `( |$)`, so sorting longest-first makes
JavaScript's leftmost-first choice coincide with POSIX's longest match.

**The one input where it matters** is `sl unipersonal`: in the SQL literal it is
listed *after* the bare `sl`, so JavaScript would strip `sl` and leave
`unipersonal`, while POSIX strips the whole thing. Sorting by length in the
TypeScript version removes the divergence. The SQL literal is deliberately left
in its human-grouped order — it is correct under POSIX regardless.

---

## 8. `btrim` is not `String.trim`

**Decision.** `packages/domain/src/normalize.ts` implements `btrimSpaces()`,
which strips **U+0020 spaces only**.

**Why.** PostgreSQL's `btrim(string)` with the default character set removes
spaces, not "whitespace". JavaScript's `String.prototype.trim()` removes tabs,
newlines, non-breaking spaces and more. A name ending in a tab would therefore
normalise differently on the two sides and produce a key the database disagrees
with. Since these keys are unique indexes and dedupe keys, "close enough" is a
data-integrity bug.

---

## 9. `normalize_domain` — a comment that is wrong, and the code that is right

The SQL comment above `app.normalize_domain` says it strips "protocol, www and
trailing path". The body strips the protocol and a leading `www.` and nothing
else — there is no path handling. **The code is the source of truth**, and
`packages/domain/src/normalize.ts` transcribes the code, not the comment, and
says so.

Consequence: `https://celler.cat/contacte` normalises to `celler.cat/contacte`,
not `celler.cat`, so two rows that differ only by path do **not** match on
`webDomainMatch`. That is conservative in the right direction (it produces a
review candidate rather than a wrong merge), so the behaviour is kept and the
comment is what should eventually be corrected.

---

## 10. Dedupe: the tax-id key is deliberately stricter than the database's

`clients.tax_id_norm` is `app.normalize_text(tax_id)`, which turns `B-12345678`
into `b 12345678` — so it does **not** collapse onto `B12345678`.
`packages/domain/src/dedupe.ts` defines `normalizeTaxId()`, which additionally
removes the spaces.

**Why.** For a fiscal identifier a hyphen or a space is pure formatting. The
database index (`clients_tax_id_uq`) still rejects the exactly-equal case; the
dedupe engine catches the differently-punctuated one and sends it to a human.
Two layers, both conservative, neither silently merging.

---

## 11. Deterministic-only auto-merge

**Decision.** The importer links a source row to an existing company without
asking in exactly three cases, and only when no hard identity field conflicts:

1. identical normalised **tax id**;
2. identical **corporate** e-mail address (a free provider — gmail, hotmail,
   telefonica.net, … — is never an identity signal) **and** an identical
   normalised company name;
3. identical normalised **phone** **and** an identical normalised company name.

Everything else — however high the similarity score — creates a new company
**and** a row in `public.duplicate_candidates` with `decision = 'PENDENT'`.

**Why.** Merging two companies destroys information in a way that is expensive to
notice and expensive to undo. A shared switchboard number is common in an
industrial estate; a shared `info@` domain is common in a group. The score
answers "how alike are these?", which is a hint for a person; `isDeterministic`
answers "may we act without asking?", which almost never is true.

**Result in practice.** The real import produced **0 automatic merges** and
**174 pending candidates**. That is the intended shape of the outcome, not a
failure of the matcher.

The importer additionally requires *name compatibility* even for a deterministic
signal: a shared phone only links when `name_norm` is equal or trigram
similarity > 0.55. And `app.merge_clients` has `EXECUTE` revoked from
`authenticated`, so no client-side path can merge at all.

---

## 12. No dated activity for undated evidence

**Decision.** `CRM_contactos_exportacion_Vitalpe.xlsm` records that a first
commercial e-mail was sent (`E-MAIL ENVIADO = SI`) but contains **no date
anywhere**. The importer records this as a company note with full provenance and
creates an **undated task**. It does not create an activity.

**Why.** `activities.occurred_on` is `not null` — the commercial history is a
timeline, and a row in it asserts "this happened on this day". Defaulting to the
import date would assert something nobody said. Defaulting to "today" would
pollute the recency windows the classification engine uses, and could flip a
company to `ACTIU SEGUR` on the strength of a fabricated timestamp.

An undated task is the honest shape for this information: it appears on the
company card, never on the daily dashboard, and can never be overdue
(`v_client_derived.overdue_tasks` and `taskRules.isOverdue` both require a date).

The same reasoning applies to `VEREMA` (harvest) in a "next action date" column:
it is real content, not a date. The task is created without a date and the
original text is preserved in the notes. `packages/domain/src/dates.ts` refuses
`verema` explicitly, with the ambiguity message
«La verema no és una data concreta: cal confirmar el dia abans de crear res.»

---

## 13. Uncatalogued products are rejected, not invented — and parked

**Decision.** A delivery-note line whose product string cannot be matched to the
normalised catalogue is **not** imported. It is written to
`public.excluded_records` with `module = 'PRODUCTE_NO_CATALOGAT'`, the full raw
row and the matcher's reason, and the staged row is marked `EXCLOSA`. The raw
string is also recorded in `unmapped_values` so it surfaces in "PENDENTS DE
REVISAR".

**Why.** `opportunities` is grained on `(client, product, campaign, data_type)`
and `product_id` is `not null`. Attaching a purchase to an invented product would
put a real volume against a product that does not exist, which then feeds
reports, forecasts and the classification engine. Creating a catalogue entry
on the fly would let a typo (`VI BALNC`, `ECOLGÒGIC`, `VI NEGE`) become a
permanent product.

**Recovery is cheap and complete.** Add the product or an alias in
ADMINISTRACIÓ and re-import: the row replays. Nothing was lost — the entire
original row is in `excluded_records.raw`.

**Result.** 24 delivery-note lines across 14 distinct descriptions are parked.
They are listed in `docs/imports/2026-07-23/IMPORT_REPORT.md`. (That generated
report calls them "rebutjades"; the mechanism is actually `EXCLOSA` +
`excluded_records`. The wording in the generator should be corrected.)

### 13.1 Bag in Box is out of scope, and stays recoverable

`BIB` / `Bag in Box` / `Doll Diví` lines belong to a future module. They are
excluded with `module = 'BAG_IN_BOX'` and the complete raw row, so the future
module can pick them up. **2** such lines exist in the sources.

### 13.2 BRISA and MARES are by-products

`BRISA` (grape pomace) and `MARES` (lees) are winery by-products, not bulk wine.
The brief keeps them out of the product catalogue, so
`scripts/import/products.ts` recognises them with `isByProduct()` and they are
excluded with `module = 'SUBPRODUCTE'` — again with the full row, because they
are real sales even though they are not this module's sales. **40** lines.

Note that the by-product rows are measured in **kg**, not litres, which is a
second reason they cannot enter a table whose volume column is `volume_liters`.

---

## 14. Campaign = 1 August → 31 July

**Decision.** `campaignForDate()` maps a delivery-note date to a campaign named
`YYYY-YYYY`, where the campaign starts on 1 August. `supabase/seed.sql` creates
`2023-2024`, `2024-2025`, `2025-2026` (`OBERTA`) and `2026-2027` (`FUTURA`) with
explicit `starts_on` / `ends_on`.

**Why.** A wine campaign runs harvest to harvest, and that is literally how the
source sheets are cut: `GUIES AGOST 24 - JULIOL 25`, `VENDES BASE CAVA GUARDA
25-26`. Using calendar years would split every campaign in two and make
"compared with last campaign" meaningless.

**Corollary.** The campaign is *never* part of a product name. `COLLITA 2025`,
`ANYADA ZERO` and bare years are stripped by `stripVintage()` before matching.
A product is a product; the year is the campaign.

---

## 15. Product matching by facets, not by an alias list

**Decision.** Both the raw delivery-note string and the catalogue name are parsed
into five facets — `kind · colour · variety · category · organic` — and a match
requires **all five** to agree. A curated alias table
(`public.product_aliases`) is consulted first for the handful of strings that no
parser should have to understand.

**Why.** The ledger strings were written by hand over three campaigns and carry
vintages, internal lot codes (`GS-CB-AF`, `G-SZ-SZZ`), brand names and typos. An
alias list would need an entry per spelling per campaign, forever. Facets
generalise: a new typo in the vintage does not break the match, and a genuinely
new product combination fails loudly instead of matching the nearest thing.

**Safety valve.** `buildCatalogueIndex()` throws if a *catalogue* name cannot be
parsed. A catalogue entry the parser cannot read is a bug in the parser, and
failing the import is better than silently matching fewer products.

---

## 16. Audio retention defaults to the minimal policy

**Decision.** `voice_notes.retention_policy` defaults to
`DELETE_AFTER_CONFIRM`. The available policies are `KEEP`,
`DELETE_AFTER_TRANSCRIPTION`, `DELETE_AFTER_CONFIRM` and `KEEP_DAYS`.

**Why.** A voice note is the rawest personal data the product holds: a recording
of a person, usually in a car, naming customers and often saying things that were
never meant for a CRM field. The business needs the *transcript*; the audio is a
means to it. Once the user has confirmed the interpretation, the recording has
served its purpose.

`DELETE_AFTER_CONFIRM` rather than `DELETE_AFTER_TRANSCRIPTION` because the user
may want to replay the audio while reviewing a proposal — the transcript can be
wrong, and there is no way to check without the original.

**Failure direction.** `shouldDeleteAudio()` is total and conservative: an
unknown policy, a missing `retention_days`, or a note still awaiting
transcription/confirmation all return "do not delete". Erring towards keeping is
recoverable; erring towards deleting is not.

---

## 17. The classification engine exists twice, guarded by a shared fixture table

**Decision.** The proposal rules live in `app.propose_classification` (PL/pgSQL)
**and** in `proposeClassification()` (TypeScript). Both are pinned by
`packages/domain/src/classification.fixtures.ts`, a 25-case truth table.
`classification.test.ts` runs it against the TypeScript function;
`supabase/tests/parity.test.ts` imports the *same* table, materialises every fact
set as real rows (opportunities, deliveries, activities, verification status,
company type) and asserts the database proposes the same value.

**Why twice at all.** SQL because triggers on `activities` and `opportunities`
must recompute the proposal the instant a fact changes, and because the importer
recomputes 802 companies in one statement. TypeScript because the UI has to
explain "why this proposal", the voice preview has to show a proposal before
anything is written, and the phone has to work offline.

**Why a fixture table rather than "be careful".** Two implementations of one rule
is a standing invitation to drift, and drift here is invisible: both sides keep
working, they just disagree. A shared table makes adding a case add it to both
suites at once, and makes a divergence a red test rather than a support ticket.

The fixture file also documents the *recipe* for materialising each fact as rows,
including two traps: `clientTypeCode: 'ALTRES'` also needs `other_client_type`
(the CHECK rejects it otherwise), and `hasRepeatSignal` must be expressed as an
activity, because an opportunity would need a `data_type` and `POSSIBLE COMPRA`
would silently switch `hasConcreteInterest` on as well.

**The rule order itself**, identical on both sides:

| # | Condition | Proposal |
| ---: | --- | --- |
| 1 | recent negative result (18 months) **or** verification `INACTIVA` | `NO POTENCIAL` |
| 2 | recent purchase **or** open confirmed forecast **or** repeat signal | `ACTIU SEGUR` |
| 3 | concrete interest | `POTENCIAL INTERESSAT` |
| 4 | other supplier **or** old purchase **or** known company type | `POTENCIAL AMB UN ALTRE PROVEIDOR` |
| 5 | otherwise | `NULL` — stays *pendent de revisar* |

Windows are single-sourced: `app.recent_purchase_months()` = 18 and
`app.verification_stale_months()` = 12, mirrored by `RECENT_PURCHASE_MONTHS` and
`VERIFICATION_STALE_MONTHS`, and the equality is itself asserted by two parity
tests.

**The engine never confirms.** `confirmed_classification` is only ever written by
`app.confirm_classification`, which raises `CONFIRMACIO_REQUEREIX_USUARI` when
`auth.uid()` is null. The AI may propose; a person confirms.

---

## 18. Haversine in SQL instead of PostGIS

**Decision.** `app.distance_meters()` is a plain `IMMUTABLE` SQL haversine on a
sphere of radius 6 371 000 m. `app.nearby_clients()` filters with a latitude /
longitude bounding box first (so the plain B-tree index
`client_locations_geo_idx` is usable) and only then applies the exact distance.
`packages/domain/src/geo.ts` transcribes both, term by term.

**Why.** PostGIS is not available in PGlite, and adding it would make the local
database — and therefore the whole test strategy — impossible. At this scale
(hundreds of locations inside one Spanish comarca) haversine error against the
WGS84 ellipsoid is far below the 120 m default geofence radius, so it changes no
decision the product makes.

**Upgrade path, when it is needed.** Add a migration that creates
`extension postgis`, adds `client_locations.geog geography(Point, 4326)` as a
generated column from the existing latitude/longitude, and a GiST index on it;
then re-implement `app.nearby_clients` with `ST_DWithin`. `app.distance_meters`
stays as-is so the TypeScript twin and the offline phone path keep working. The
signature of `nearby_clients` does not change, so no caller moves. The local test
harness would then need PostGIS too — which is the real cost, and the reason it
has not been done.

---

## 19. The iOS 20-region geofence cap drives the design

**Decision.** `IOS_MAX_MONITORED_REGIONS = 20`. `selectRegions()` ranks
candidates into seven tiers and truncates to the cap.
`notification_settings.max_geofence_regions` defaults to 20 (allowed range
1–100) so the limit is also a user-visible setting.

**Why.** iOS monitors at most 20 regions per application, system-wide for that
app. With 802 companies the interesting question is therefore never "which
companies have coordinates" but "which twenty matter right now". Registering the
nearest twenty would be wrong: the company you have a visit booked at today
matters more than one you happen to be driving past.

**The tiers, in order** (the string is stored verbatim in
`geofence_registrations.selection_reason`, so a user can be told *why* they got
an alert):

`VISITA AVUI` → `VISITA PROPERA` → `CLIENT ASSIGNAT` → `TASCA PRIORITARIA` →
`PROP DE LA ULTIMA POSICIO` → `VISITAT RECENTMENT` → `FIXAT MANUALMENT`.

A candidate matching none of the seven is not registered at all. Ties break by
soonest visit (tiers 1–2), most recent visit (tier 6), then distance, then input
order — so the selection is deterministic and testable.

Android has no such hard cap, but the same list is used: a consistent rule that
can be explained beats two behaviours.

---

## 20. Arrival confidence: `AMBIGUA` is evaluated before `ALTA`

**Decision.** `arrivalConfidence()` returns `BAIXA` when outside the radius or
when the movement looks like a pass-through (dwell < 120 s, or speed ≥ 20 km/h),
then **`AMBIGUA` when more than one company could plausibly be at this spot**,
and only then `ALTA` (inside the radius *and* a visit within ±2 h) or `MITJANA`.

**Why the order matters.** In an industrial estate three of our companies can
share a car park. A booked visit is strong evidence about *intent* but not about
*which door the user walked through*. Asserting `ALTA` there means the
notification says "You have arrived at X" when the user is at Y — a confident
lie, which is worse than a question. With `AMBIGUA` the notification asks.

The alternative order (visit wins over ambiguity) was rejected for that reason:
the cost of a wrong confident claim is a visit recorded against the wrong
company, which then feeds the commercial history and the classification engine.

---

## 21. One entity for tasks, reminders and "next actions"

**Decision.** `public.tasks` covers all three. `kind` distinguishes `TASCA` from
`RECORDATORI`; `due_at IS NULL` marks a "next action" attached to the company.

**Why.** They differ by two attributes, not by nature, and the alternative —
three tables — would triple the RLS surface, the audit surface and the number of
places the dashboard has to union. An undated task appears on the company card,
never on the daily dashboard, and is never overdue. Giving it a date is
`app.schedule_undated_task`, which updates the same row rather than cloning it,
so the identity and the audit trail survive.

**Postponing** (`app.postpone_task`) sets `AJORNAT` and then immediately returns
the row to `PENDENT` with the new date, in one transaction. The `AJORNAT` state
is therefore never observable from outside — it exists so the CHECK constraint
`tasks_postponed_needs_new_date` fires if a caller ever tries to postpone
without a date. Keeping one row means the dashboard shows the task once and the
audit trail stays linear.

---

## 22. Completing a task and writing history are one operation

**Decision.** `app.complete_task(task_id, result, notes)` closes the task,
derives the activity type from the action, inserts the `activities` row, and
marks the linked visit `FETA` — in one transaction, in one function.

**Why.** "Mark done" and "record what happened" being two calls means the second
one can fail, or be skipped, and the commercial history quietly develops holes.
The rule "a completed commercial task always leaves a trace" is only true if it
is impossible to do one without the other.

**Why SECURITY INVOKER.** So RLS applies to the caller. That created the bug the
tests found:

> The `SELECT ... FOR UPDATE` at the top succeeds for any workspace member, but
> the `UPDATE` is filtered by the `tasks_update` policy. Before the fix, a
> commercial could fail to close someone else's task and **still** write an
> activity for it.

The fix is the `returning id into v_updated` plus an explicit
`SENSE_PERMIS_PER_TANCAR_TASCA` (SQLSTATE 42501) when nothing was updated. In
current PostgreSQL the `FOR UPDATE` is itself policy-filtered, so the function
usually stops earlier with `TASCA_NO_TROBADA`; the test accepts either, because
what matters is that it refuses and writes nothing.

---

## 23. Google Calendar: identity by extended properties, and a hash to kill echo loops

**Decision.** Every pushed event carries private extended properties
`crmWorkspaceId`, `crmClientId`, `crmVisitId`, `crmTaskId`. Events are matched by
those, never by title. `calendar_event_links.content_hash` stores the hash of the
last payload pushed or pulled; `reconcile()` short-circuits when both sides hash
the same.

**Why extended properties.** Titles are user-editable, get translated, get
typo'd, and two companies can legitimately share a name.

**Why the hash.** After applying a pull, the CRM content hashes to exactly what
Google holds, so the next push planner sees `ALREADY_CONVERGED` and says nothing.
That single check is what makes "a change pulled from Google is never echoed
back" a property that can be asserted in a pure unit test rather than hoped for
in production. `reconcile()` does no I/O and takes its clock as an argument
precisely so this is testable.

**Scopes are minimal**: `calendar.events` and
`calendar.calendarlist.readonly`. `calendar.app.created` is requested **only**
when the user opts into a dedicated "Visites Vitalpe" calendar. `calendar` and
`calendar.readonly` would hand us the user's entire personal agenda, which this
product has no business reading.

**Cancellation never deletes.** A cancellation on the provider cancels the visit
(`app.cancel_visit`), preserving the CRM history. A deleted visit takes its
history with it.

---

## 24. A local provider for every integration, and it is not a stub

**Decision.** Google Calendar, transcription, interpretation and geocoding each
have a local implementation selected automatically when the credential is absent.
`LocalCalendarProvider` implements ETags, `If-Match` conflicts, expiring
incremental sync tokens, watch channels with increasing message numbers, and
cancelled-not-deleted events.

**Why.** Two reasons, and the second one is the important one.

1. The product must be usable before anyone has bought an API key.
2. If the fallback were a stub, the *interesting* code — reconciliation, webhook
   verification, idempotency, token expiry — would only ever run against a live
   Google account, i.e. would never be tested. Because the local provider honours
   the same contract, `create → push → edit in calendar → webhook → pull →
   reconcile` is exercised end to end in CI with no credentials.

The geocoder is the exception that proves the rule: its local implementation
returns `PENDENT DE GEOLOCALITZAR`, never coordinates. A wrong latitude is worse
than no latitude — it puts a geofence on someone else's building and fires an
arrival notification for the wrong client.

---

## 25. Sampling parameters are not sent to models that reject them

`acceptsSamplingParams(model)` returns false for `claude-opus-4-7`,
`claude-opus-4-8`, `claude-sonnet-5`, `claude-fable-5` and `claude-mythos-5`.
`temperature` was removed from those families and a request that includes it is
rejected with a 400. "Low temperature" is therefore expressed **structurally** on
those models — a forced tool call and a closed output schema — and the parameter
is only sent where it still exists.

---

## 26. Secret box: AES-256-GCM with a fixed KDF salt

**Decision.** `packages/config/src/crypto.ts` encrypts stored secrets as
`v1:<iv>:<tag>:<ciphertext>`, AES-256-GCM, 12-byte random IV per message,
16-byte tag, key derived from `APP_ENCRYPTION_KEY` with scrypt and a **constant**
salt.

**Why a fixed salt is acceptable here.** The envelope has no room for a
per-message salt, and the input is a high-entropy application secret (≥ 32
characters, generated once with `openssl rand -base64 48`), not a user-chosen
password. scrypt is being used for key stretching and domain separation, not to
make a weak password expensive to brute-force. Per-message randomness lives in
the IV, which is where GCM needs it.

**Rotation** means bumping the version prefix and re-encrypting; the parser
rejects any prefix it does not know, so a half-rotated database fails loudly.

---

## 27. Soft delete everywhere, hard delete almost nowhere

`clients`, `contacts`, `client_locations`, `opportunities`, `activities`,
`tasks`, `visits` and `products` all carry `deleted_at`. Unique indexes are
partial (`where deleted_at is null`) so a deleted name frees its slot.
`activities` additionally requires a reason (`activities_delete_needs_reason`)
and has **no DELETE policy at all** — commercial history is corrected, never
removed. Only an ADMIN has a `DELETE` policy on `clients`.

---

## 28. Documentation is generated from the source registry

`scripts/import/sources.ts` declares every file and every sheet — including the
ones deliberately not imported, with the reason. `SOURCE_INVENTORY.md`,
`COLUMN_MAPPING.md` and the reconciliation table in `IMPORT_REPORT.md` are all
generated from it. A sheet cannot be silently dropped, because dropping it would
mean deleting it from the registry, which changes the generated inventory.

---

## 29. Known open decisions

Recorded so they are not mistaken for oversights.

| Item | State |
| --- | --- |
| Field-level provenance | Table, indexes, RLS and writer exist; `prov()` is never called, so `field_provenance` is empty. Row-level provenance is complete. |
| Import undo | Schema supports it (`imports.undone_at`, `import_rows.entities_created`, `client_merges.snapshot`); no script or UI implements it. |
| `postgres.js` transaction affinity | See §3. Must be fixed before the hosted backend takes concurrent traffic. |
| Writable master data | `products`, `product_aliases`, `campaigns` and `client_types` have SELECT-only policies, so the ADMINISTRACIÓ screens cannot write them as `authenticated`. Either add ADMIN write policies or route those screens through the service role deliberately. |
| `google_calendar_connections` DELETE | `revoke select, insert, update` did not revoke `DELETE`, so a user can delete their own connection row. Harmless, arguably intended, but it is an implicit grant rather than an explicit one. |

---

## 30. Transaction affinity is a security property, not a performance one

`withUser()` issues `BEGIN`, `SET LOCAL ROLE authenticated`,
`set_config('request.jwt.claim.sub', …, true)` and then the actual query. All of
those are **transaction-scoped**.

The first implementation sent them through a `postgres.js` pool of 5 with
`sql.unsafe()`. Under concurrent traffic each statement can land on a *different*
connection — which means a query could execute with **no RLS context set at
all**. That is not a slow path; it is a hole.

The backend now exposes `transaction(fn)` instead of `query(sql)`:

- **postgres.js** — `sql.reserve()` pins one connection for the whole
  transaction and releases it in a `finally`.
- **PGlite** — a single embedded connection, so "reserving" is a mutex.
  Overlapping transactions would interleave their `BEGIN`/`COMMIT` and corrupt
  each other's scope, so requests are serialised through a promise chain that
  survives rejections.

The same reasoning already applied in the test harness: `asUser()` wraps
everything in a transaction because `SET LOCAL` outside one silently does
nothing — and a suite that passes because the role never changed proves nothing.
That was the first bug this project found, and it is the same bug twice.

---

## 31. `schema_migrations` has RLS and no policy

The local migration ledger is a table in `public`, so `pnpm db:local`'s
"every public table has RLS" assertion caught it immediately. RLS is enabled and
**no policy is granted**: it is infrastructure, not data, and nothing reachable
through the API has any business reading it.

Keeping the assertion honest was worth more than the two lines it cost. This is
also why the ledger lives in the PGlite harness rather than in a migration — on
hosted Supabase the CLI does its own tracking, and the production schema has 41
tables, not 42.

---

## 32. `lint` and `typecheck` now exist

Both scripts were declared in `package.json` with nothing behind them.

- `eslint.config.mjs` — flat config, deliberately narrow: unused symbols,
  `any` creeping into the data layer, caught-error causes. Formatting is not
  linted; there is no style argument to have here. It found two real defects
  (a dead assignment and a discarded error cause).
- `tsconfig.build.json` — type checks `packages`, `scripts` and the SQL test
  suites. The web app is checked by `next build`, which understands the App
  Router's generated types; running `tsc` over it directly reports false errors
  about route props that do not exist until build time.

Fixing the resulting errors exposed a genuine typing bug: a generic helper
`ok<T>(value: T | null, …)` inferred `T = null` when called as `ok(null, …)`,
producing a `Normalized<null>` no caller could consume. Split into `ok()` and
`empty()`, where `empty()` returns `Normalized<never>` — assignable to every
`Normalized<T>`.

---

## 33. Deep-link authority parsing

`vitalpe://arribada?candidats=…` has no path: everything after `//` is the
authority. The parser split the authority on `/` only, so the query string was
swallowed into the host and never parsed — the multi-candidate arrival chooser
could never have opened.

The authority now ends at the first `/`, `?` or `#`, per RFC 3986. Caught by the
mobile test suite, which is the only reason it was found before a device ever
ran the code.

---

## 34. The supervisor reads; she does not co-edit

The original brief described ADMIN, GERENT and COMERCIAL as three ranks, and the
first implementation followed it: `app.is_manager()` — ADMIN **or** GERENT —
gated both reading and writing. That was wrong about the business.

Vitalpe has one commercial. The CRM is his personal working tool. The other
person in the system is his superior, and what she needs is to see what he did:
activities, closed clients, visits made, what was observed in them, what came out
of them. Not to co-edit his portfolio.

So `20260724150000_supervisor_read_only.sql` moves **every** write policy from
`app.is_manager()` to `app.is_admin()` and drops GERENT from
`app.can_edit_client()`. `app.is_manager()` survives untouched and still governs
`SELECT` for both tiers — which is the whole point: she sees everything and
changes nothing.

Two consequences worth stating:

- The satellites came free. Contacts, locations, opportunities and verifications
  all route through `can_edit_client`, so removing GERENT there removed it from
  all of them at once. The one that did **not** route through it —
  `client_verifications_insert`, gated on membership alone — had to be fixed by
  hand, and would have been the hole left behind.
- The read-only tier is enforced in the database, not in the navigation.
  `/supervisio` is her landing page and the working tools are absent from her
  menu, but that is ergonomics. Six tests in `el supervisor només mira` assert
  the writes fail at the policy, which is the part that would still hold if the
  interface were bypassed entirely.

## 35. The imported portfolio had no owner

`owner_id` is what `can_edit_client` reads for the COMERCIAL tier, and the 801
imported companies had it `null`: the source spreadsheets never named a
commercial, and the importer does not invent data. With the role model corrected
this became unambiguous — there is one commercial — so `pnpm clients:assign`
sets it, in one audited statement.

The script simulates by default and only writes with `--apply`; it refuses a
GERENT (recording an owner who cannot act on the rows); it never takes a company
off somebody who already owns it, because a silent reassignment is precisely
what the audit log exists to make impossible; and it rolls back if the number of
rows it touched differs from the number it reported, rather than print a figure
that was never true.

## 36. The importer no longer decides its own target

`.env.local` exists so credentials never travel through a command line. The side
effect: merely having the file makes `DATABASE_URL` set, so `pnpm import:run`
silently targeted the hosted database. And `--fresh` compounded it — it reads as
"start from scratch", but the code only ever deleted the local `.data/crm`
directory, so against a remote database the flag was a no-op attached to a
production write.

That combination fired: a run meant to rebuild the local copy went to Supabase
and was interrupted part-way. The damage was recoverable and worth recording
precisely, because it says something about the design:

- **No company, opportunity, activity, contact or duplicate candidate was
  created.** The importer matches deterministically, and re-reading the same
  sources produced the same values. Every audit row from that run lists exactly
  one changed field: `updated_at`. Idempotence is not a nicety here; it is what
  turned a bad command into a bumped timestamp.
- What it did leave was an **open run**: an `imports` row stuck at
  `INSPECCIONAT` and 1,182 staged rows at `PENDENT`, which the production audit
  correctly flagged. `pnpm import:abandon` closes such a run — status `DESFET`,
  a written reason, unapplied rows marked `IGNORADA`, already-applied rows left
  alone because they describe work that really happened. It refuses an `APLICAT`
  import: undoing an applied import is a different operation.

The guard: `pnpm import:run` refuses to write to a non-local `DATABASE_URL`
without `--remote`, refuses `--fresh` against a remote database at all, and
prints which database it opened. `pnpm import:local` forces the throwaway copy
through an explicit `local: true` option rather than by unsetting an environment
variable, so the intent lives in the code and not in the shell.

No confirmation prompt was added. A prompt in a script that is run repeatedly
gets answered by habit; a flag that has to be typed does not.

## 37. The database handle lives on `globalThis`, not in a module variable

`.data/crm` was corrupted twice during this work, and the second time nothing
was running against it except the dev server — which is supposed to be its only
writer. The cause was the cache, not the concurrency:

```ts
let backendPromise: Promise<Backend> | null = null;   // one cache per module instance
```

In development every hot reload evaluates a **fresh instance** of the module,
and a fresh instance means a fresh `null`. With Postgres that leaks a pool and
nobody notices. With PGlite it is destructive: PGlite is a single embedded
writer over a directory, so the second instance opening `.data/crm` corrupts it.
The process then dies with `RuntimeError: Aborted()` and every request 500s
until the database is rebuilt from the sources.

This is exactly what the E2E suite hit: seven tests passed, a write-heavy flow
triggered a reload, and the eighth found a dead database — which read, from the
outside, like a bug in the page it happened to be on. Two hours went into the
wrong suspect.

The handle now lives under `Symbol.for('vitalpe.crm.backend')` on `globalThis`,
which survives module reloads. The single-writer rule is unchanged and still
matters — do not run the importer and the dev server at the same time — but the
app can no longer break it on its own.

## 38. Two E2E tests only passed on a virgin database

The E2E config claims the suite "picks subjects dynamically … so re-runs against
a mutated database still pass". Two tests did not honour that, and both failures
looked like product bugs until they were read carefully:

- The classification test named CAN QUETU. Its own first run confirms that
  company, so its second run found a panel offering **TORNAR A CONFIRMAR**
  instead of **CONFIRMAR** and timed out. It now takes whichever company is
  still pending and accepts either label — same action, two names.
- The visit test asserted that "CAN QUETU" was visible after saving. The chosen
  company is displayed *inside the form*, so the assertion would have passed on
  a form that never submitted. It now waits for the form to close, then anchors
  the day view on the visit's own date — the calendar opens on today, and the
  visit is tomorrow.

Chasing the second one found a real defect: `/tasques` crashed with
`(row.due_at ?? '').slice is not a function`. Both drivers return a `Date` for
`timestamptz`, but the row interface declared `string | null`, so the compiler
had no objection. The link is only rendered for visit-linked tasks, which is why
the page looked fine until a visit existed — and it would have crashed in
production the same way. Fixed with `toCivilDate()`, which also stops a 23:30
Madrid visit from linking to the previous day, and the interface now says
`Date | string | null` — what actually arrives.

## 39. Sign-in is a password, not an e-mailed code

The first build signed in with a six-digit code by e-mail — passwordless, nothing
to store or forget. In production that ran straight into the wall it depends on:
Supabase's built-in mailer sends whatever the default template renders (a magic
**link**, not a code), the template cannot be edited without configuring a custom
SMTP provider, and the mailer is rate-limited to a few messages an hour. So the
one commercial who signs in every day would depend on an unconfigurable,
throttled mail path — and the emails that did arrive pointed at `localhost:3000`.

Switched to `signInWithPassword`. The e-mail is out of the login path entirely:
no template to edit, no SMTP to stand up, no rate limit, no redirect URL to get
right. The security model is unchanged — authentication still only proves the
credentials, and the session cookie is opened only after the same active-
membership check as before.

- Accounts are created by `pnpm user:add`; the password is set by
  `pnpm user:password -- <email> --generate`, which mints a strong password from
  the CSPRNG (rejection-sampled, no modulo bias, no look-alike characters) and
  prints it exactly once. It is never written to a file or a log.
- The accounts were created with `email_confirm: true`, so a password works
  immediately — a project that required e-mail confirmation would otherwise
  block the very login this enables, using the mailer this approach avoids.
- Changing one's own password (EL MEU COMPTE) verifies the current password with
  `signInWithPassword` before the service role sets the new one: a valid session
  cookie is not proof of knowing the password, and a borrowed unlocked screen
  must not lock the owner out.

The trade this accepts: a forgotten password needs an administrator to set a new
one (`pnpm user:password`), because self-service reset is the one thing that
does need the mailer. For a two-person tool that is the right amount of process.

## 37. The phone speaks HTTP, so the voice pipeline left the actions file

React Native cannot call a Next.js server action: that is a browser/RSC wire
protocol, not an API. The mobile app therefore needs real endpoints, and the
obvious shortcut — export the session-taking functions from
`lib/actions/voice.ts` and call them from a route handler — is a hole. **Every
export of a `'use server'` file is a callable server action**, so exporting
`applyProposalFor(session, formData)` there would have let any browser post a
session of its choosing and act as another user.

So the pipeline moved to `lib/voice/pipeline.ts`, a plain server-only module.
`lib/actions/voice.ts` is now four thin wrappers that resolve the session from
the cookie, and `app/api/veu/{interpretar,aplicar}` are two route handlers that
resolve it from an `Authorization: Bearer` token. Both call the same functions,
so the phone cannot drift from the web on what an action is allowed to do.

`sessionFromBearer()` verifies the token by asking Supabase who it belongs to,
never by decoding it locally — a locally-decoded JWT is trusted input. It then
runs the same active-membership check as the cookie path, sharing
`sessionForUser()` so the two definitions of "authorised" cannot diverge.

## 38. The mobile app had never been built, and it showed

The arrival logic was complete and well tested, but `apps/mobile` had no `app/`
directory and its dependencies had never been installed. Building it for the
first time surfaced four defects that no unit test could have caught, because
they all live in configuration and module resolution:

- `ios.deploymentTarget: '15.1'` is below this SDK's minimum of 16.4, which made
  **every** config resolution throw — the app could not even be described, let
  alone compiled.
- `newArchEnabled` and `android.edgeToEdgeEnabled` no longer exist in the config
  types (both are now the platform default).
- `@expo/metro-runtime`, a peer dependency of `expo-router`, was missing —
  pnpm's strict linker does not hoist it.
- Metro could not resolve the workspace packages, which are ESM TypeScript and
  import siblings as `./foo.js` while the file on disk is `./foo.ts`. The web
  bundler understands this; Metro needed an explicit `resolveRequest` that
  retries a failed relative `.js` as `.ts`/`.tsx`.

Two structural decisions came out of it. `TaskManager.defineTask` is called at
**module scope** in `src/runtime/geofencing.ts` and imported for its side effect
by the root layout: when the OS cold-boots the app for a region crossing it
looks the task up immediately, so a task defined inside a component or a lazy
import simply would not exist — the classic "works in development, never fires
in production". And the code is split into `src/core/` (pure, tested, no device
API) and `src/runtime/` (device only), which is what lets the entire decision
path be verified in Node before any build exists.

The honest limit is recorded in `docs/MOBILE_SETUP.md`: bundling proves the code
loads, not that a phone in a cellar receives a geofence event. Twelve checks
need a real device, and until they are done the feature is *implemented but not
proven*.

## 39. The cleaned list is a working list, not a deletion

Carlos cut his operational workbook from 801 companies to 347. The tempting
reading — "delete the rest" — is wrong, and the data says why: 507 CRM companies
fall outside the cleaned list and **29 of them have real purchases totalling 2.6
million litres**. Pinord alone is 615.000 L. Several are the same company under
a different spelling ("BERRAL Y MIRÓ SL" against the workbook's "VARIAS / BERRAL
I MIRÓ").

So membership became a flag, `clients.in_working_list`. The default screens and
the route planner follow Carlos's 347; nothing is deleted, no litre of history
moves, and a company can come back by appearing in the next workbook. Cleaning a
prospecting sheet is a statement about what is being worked this season, not
about who ever bought anything.

Matching is deterministic or it is a question. A row matches by normalised name,
by alias, by its `VIT-GR-nnnn` id, or by either half of the "RAÓ SOCIAL - MARCA"
convention the workbook uses — that last rule alone resolved 29 of the 92
apparent misses. The remaining 63 create a new company **and** queue a duplicate
candidate when something similar exists, so the existing merge screen decides.
Nothing is merged silently.

## 40. Routes are grouped by comarca because there are no coordinates

Not one company on the working list is geocoded. So a route planner cannot
optimise distance, and any "shortest path" it printed would be fiction.

What every company does have is a municipality, and municipalities belong to
comarques — real, checkable geography. So a zone is a comarca, one zone per
working day, and the claim is only ever *these companies are due, and these ones
are near each other*. Order inside a day is by urgency, not by geography, and
the page says so. A municipality missing from the map becomes its own zone: we
know where it is, we do not claim to know what it is near.

Every stop carries the reasons it was chosen — overdue tasks, silence, litres at
stake — because a suggestion the commercial cannot audit is one he stops
trusting the first time it looks odd, and he is the one who knows which cellar
shuts on Mondays. The weights live in one exported object so the ranking can be
argued with rather than reverse-engineered.

## 41. Prospects carry a source or they do not exist

"Find me companies I haven't got" is one instruction away from inventing
customers, which is the one thing this system must never do. So the
`prospects` table requires a `source`, keeps a `source_url`, and records the day
the register was consulted. A prospect has no history, cannot be assigned, and
becomes a company only when a person presses a button — the conversion writes
the source into the new company's notes and leaves the classification empty,
because an unqualified lead is exactly a company nobody has judged yet.

The first two passes were run against the public registers of the DO Penedès and
the DO Catalunya. The result is worth recording: of 260 published wineries,
**258 were already in the base**. The portfolio is far more complete than it
looked, and the useful prospecting ground is elsewhere — bottlers without
vineyards, other DOs, outside Catalonia. A discovery pass that finds almost
nothing is a real answer, not a failed run.
