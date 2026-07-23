import 'server-only';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { withServiceRole, withUser, type Query } from '@/lib/db';
import {
  LocalCalendarProvider,
  GoogleCalendarProvider,
  buildCrmEvent,
  contentHash,
  crmToContent,
  linkAfterPull,
  linkAfterPush,
  reconcile,
  refreshAccessToken,
  renewalPlan,
  remoteToContent,
  verifyChannel,
  SyncTokenInvalidError,
  type CalendarEventLink,
  type CalendarProvider,
  type ChangeList,
  type CrmEvent,
  type EventContent,
  type GoogleOAuthConfig,
  type GoogleTokens,
  type HeaderBag,
  type RemoteEvent,
  type SyncAuditRecord,
  type VisitStatus,
} from '@vitalpe/integrations/calendar/index';
import { decryptSecret, encryptSecret } from '@vitalpe/config';

/**
 * The CRM side of the calendar port.
 *
 * Two hard rules shape this file:
 *
 *  1. **Nothing here depends on Google being configured.** Without
 *     `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI` the same
 *     code runs against `LocalCalendarProvider`, persisted to a JSON file, so
 *     create → push → edit-in-calendar → webhook → pull → reconcile is
 *     exercisable end to end on a laptop. The UI says so plainly.
 *  2. **A change pulled from Google is never echoed back.** The decision is
 *     taken by the pure `reconcile()` in `@vitalpe/integrations`; this file
 *     only stores what it says to store. After a pull, `content_hash` holds
 *     the hash of what was applied, so the next planner sees
 *     `ALREADY_CONVERGED` and stays quiet. Nothing in the pull path calls a
 *     push.
 *
 * Token handling: `access_token_enc` / `refresh_token_enc` / `sync_token` are
 * revoked from the `authenticated` role at column level, so every read of them
 * goes through `withServiceRole` and the plaintext never leaves this module.
 */

export const DEDICATED_CALENDAR_NAME = 'VITALPE — VISITES COMERCIALS';
const TZ = 'Europe/Madrid';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface GoogleConfigReport {
  readonly configured: boolean;
  readonly missing: readonly string[];
  readonly webhookUrl: string | null;
  readonly encryptionKeyPresent: boolean;
  readonly redirectUri: string | null;
}

function envValue(name: string): string {
  return (process.env[name] ?? '').trim();
}

export function appUrl(): string {
  return envValue('NEXT_PUBLIC_APP_URL') || 'http://localhost:3004';
}

export function googleOAuthConfig(): GoogleOAuthConfig | null {
  const clientId = envValue('GOOGLE_CLIENT_ID');
  const clientSecret = envValue('GOOGLE_CLIENT_SECRET');
  const redirectUri = envValue('GOOGLE_REDIRECT_URI') || `${appUrl()}/api/google/callback`;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri };
}

/** Never reads a secret's value — only whether it is present. */
export function googleConfigReport(): GoogleConfigReport {
  const missing = (['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] as const).filter(
    (name) => envValue(name) === '',
  );
  return {
    configured: missing.length === 0,
    missing,
    webhookUrl: envValue('GOOGLE_CALENDAR_WEBHOOK_URL') || null,
    encryptionKeyPresent: envValue('APP_ENCRYPTION_KEY').length >= 32,
    redirectUri: envValue('GOOGLE_REDIRECT_URI') || null,
  };
}

/**
 * Encryption at the application boundary.
 *
 * Without `APP_ENCRYPTION_KEY` we refuse to store a token rather than storing
 * it in the clear — but only the *Google* path ever needs one, so the local
 * provider keeps working.
 */
function seal(plain: string): string {
  return encryptSecret(plain);
}
function open(cipher: string | null): string | undefined {
  if (!cipher) return undefined;
  try {
    return decryptSecret(cipher);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

export interface ConnectionRow {
  id: string;
  workspace_id: string;
  user_id: string;
  provider: string;
  google_account_email: string | null;
  calendar_id: string | null;
  calendar_name: string | null;
  status: string;
  scopes: string[] | null;
  token_expires_at: string | null;
  last_sync_at: string | null;
  last_error: string | null;
  disconnected_at: string | null;
}

interface SecretRow extends ConnectionRow {
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  sync_token: string | null;
}

const PUBLIC_COLUMNS = `id, workspace_id, user_id, provider, google_account_email, calendar_id,
  calendar_name, status, scopes, token_expires_at, last_sync_at, last_error, disconnected_at`;

/** Connection as the UI may see it. Tokens are never part of the shape. */
export async function readConnection(userId: string): Promise<ConnectionRow | null> {
  return withServiceRole((q) =>
    q.one<ConnectionRow>(
      `select ${PUBLIC_COLUMNS} from public.google_calendar_connections
        where user_id = $1 order by case provider when 'google' then 0 else 1 end limit 1`,
      [userId],
    ),
  );
}

async function readSecrets(connectionId: string): Promise<SecretRow | null> {
  return withServiceRole((q) =>
    q.one<SecretRow>(
      `select ${PUBLIC_COLUMNS}, access_token_enc, refresh_token_enc, sync_token
         from public.google_calendar_connections where id = $1`,
      [connectionId],
    ),
  );
}

/**
 * Guarantees a connection row exists.
 *
 * With Google configured the row is only created by the OAuth callback. Without
 * it, a `local` connection is provisioned on first use so the whole feature —
 * links, watch channels, webhook bookkeeping, reconciliation — runs against the
 * same tables it will use in production.
 */
export async function ensureConnection(
  userId: string,
  workspaceId: string,
): Promise<ConnectionRow> {
  const existing = await readConnection(userId);
  if (existing && existing.status !== 'DESCONNECTAT') return existing;
  if (existing && existing.provider === 'google') return existing;

  return withServiceRole(async (q) => {
    const row = await q.one<ConnectionRow>(
      `insert into public.google_calendar_connections
         (workspace_id, user_id, provider, calendar_id, calendar_name, status, scopes)
       values ($1, $2, 'local', 'primary', 'CALENDARI LOCAL', 'CONNECTAT', '{}')
       on conflict (user_id, provider) do update
         set status = 'CONNECTAT', disconnected_at = null, last_error = null
       returning ${PUBLIC_COLUMNS}`,
      [workspaceId, userId],
    );
    if (!row) throw new Error('No s’ha pogut crear la connexió de calendari.');
    return row;
  });
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/**
 * The local provider is a module singleton persisted to a JSON file next to the
 * database, so a visit created in one request is still there in the next one
 * and after a restart. Cached on `globalThis` because Next re-evaluates modules
 * on every hot reload in development.
 */
const LOCAL_FILE =
  process.env.LOCAL_CALENDAR_FILE ??
  path.resolve(process.cwd(), '../../.data/calendari-local.json');

interface LocalHolder {
  __vitalpeLocalCalendar?: LocalCalendarProvider;
}

export function localProvider(): LocalCalendarProvider {
  const holder = globalThis as unknown as LocalHolder;
  holder.__vitalpeLocalCalendar ??= new LocalCalendarProvider({
    filePath: LOCAL_FILE,
    defaultTimeZone: TZ,
  });
  return holder.__vitalpeLocalCalendar;
}

export interface ResolvedProvider {
  readonly provider: CalendarProvider;
  readonly connection: ConnectionRow;
  readonly calendarId: string;
  readonly isGoogle: boolean;
  /** `null` when nothing is wrong. Populated when a token is unusable. */
  readonly problem: string | null;
}

async function persistTokens(connectionId: string, tokens: GoogleTokens): Promise<void> {
  await withServiceRole((q) =>
    q.run(
      `update public.google_calendar_connections
          set access_token_enc = $2,
              refresh_token_enc = coalesce($3, refresh_token_enc),
              token_expires_at = $4::timestamptz,
              status = 'CONNECTAT',
              last_error = null
        where id = $1`,
      [
        connectionId,
        seal(tokens.accessToken),
        tokens.refreshToken ? seal(tokens.refreshToken) : null,
        tokens.expiresAt ?? null,
      ],
    ),
  );
}

/** Resolves the provider for a connection, refreshing an expired token first. */
export async function resolveProvider(connectionId: string): Promise<ResolvedProvider | null> {
  const row = await readSecrets(connectionId);
  if (!row) return null;
  const calendarId = row.calendar_id ?? 'primary';
  const config = googleOAuthConfig();

  if (row.provider !== 'google' || !config) {
    return {
      provider: localProvider(),
      connection: strip(row),
      calendarId,
      isGoogle: false,
      problem: null,
    };
  }

  let accessToken = open(row.access_token_enc);
  const refreshToken = open(row.refresh_token_enc);
  const expiresAt = row.token_expires_at ? Date.parse(row.token_expires_at) : 0;
  const stale = !accessToken || (expiresAt > 0 && expiresAt - Date.now() < 60_000);

  if (stale && refreshToken) {
    try {
      const refreshed = await refreshAccessToken(config, refreshToken);
      await persistTokens(connectionId, refreshed);
      accessToken = refreshed.accessToken;
    } catch (error) {
      await markConnectionError(connectionId, describe(error), 'TOKEN INVALID');
      return {
        provider: localProvider(),
        connection: strip(row),
        calendarId,
        isGoogle: false,
        problem:
          'No s’ha pogut renovar l’accés a Google. Cal tornar a connectar el compte.',
      };
    }
  }

  if (!accessToken) {
    return {
      provider: localProvider(),
      connection: strip(row),
      calendarId,
      isGoogle: false,
      problem: 'La connexió amb Google no té cap testimoni d’accés utilitzable.',
    };
  }

  const tokens: GoogleTokens = {
    accessToken,
    ...(refreshToken === undefined ? {} : { refreshToken }),
    ...(row.token_expires_at === null ? {} : { expiresAt: row.token_expires_at }),
  };

  return {
    provider: new GoogleCalendarProvider({
      config,
      tokens,
      defaultTimeZone: TZ,
      onTokensRefreshed: (next) => persistTokens(connectionId, next),
    }),
    connection: strip(row),
    calendarId,
    isGoogle: true,
    problem: null,
  };
}

/** Drops the three secret columns. Nothing outside this module sees them. */
function strip(row: SecretRow | ConnectionRow): ConnectionRow {
  const {
    access_token_enc: _a,
    refresh_token_enc: _r,
    sync_token: _s,
    ...rest
  } = row as SecretRow;
  void _a;
  void _r;
  void _s;
  return rest;
}

export async function markConnectionError(
  connectionId: string,
  message: string,
  status?: string,
): Promise<void> {
  await withServiceRole((q) =>
    q.run(
      `update public.google_calendar_connections
          set last_error = $2, status = coalesce($3, status) where id = $1`,
      [connectionId, message.slice(0, 500), status ?? null],
    ),
  );
}

// ---------------------------------------------------------------------------
// Building a CRM event from a visit
// ---------------------------------------------------------------------------

interface VisitSyncRow {
  visit_id: string;
  workspace_id: string;
  client_id: string;
  client_name: string;
  task_id: string | null;
  user_id: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  objective: string | null;
  important_info: string | null;
  reminders_minutes: number[] | null;
  updated_at: string;
  address: string | null;
  address_verified: boolean | null;
  contact_name: string | null;
  contact_role: string | null;
  contact_phone: string | null;
  product_name: string | null;
}

const VISIT_SYNC_SELECT = `
  select v.id as visit_id, v.workspace_id, v.client_id, c.name as client_name,
         v.task_id, v.user_id, v.starts_at, v.ends_at, v.status::text as status,
         v.objective, v.important_info, v.reminders_minutes, v.updated_at,
         l.formatted_address as address, l.verified_by_user as address_verified,
         nullif(btrim(concat_ws(' ', ct.first_name, ct.last_name)), '') as contact_name,
         ct.role_title as contact_role, ct.phone as contact_phone,
         p.name as product_name
    from public.visits v
    join public.clients c on c.id = v.client_id
    left join public.client_locations l on l.id = v.location_id and l.deleted_at is null
    left join public.tasks t on t.id = v.task_id
    left join public.products p on p.id = t.product_id
    left join lateral (
      select ct.* from public.contacts ct
       where ct.client_id = v.client_id and ct.deleted_at is null and ct.is_active
       order by ct.is_primary desc, ct.created_at limit 1
    ) ct on true
   where v.id = $1 and v.deleted_at is null`;

function toCrmEvent(row: VisitSyncRow): CrmEvent {
  return buildCrmEvent(
    {
      workspaceId: row.workspace_id,
      clientId: row.client_id,
      visitId: row.visit_id,
      ...(row.task_id ? { taskId: row.task_id } : {}),
      updatedAt: new Date(row.updated_at).toISOString(),
    },
    {
      companyName: row.client_name,
      clientId: row.client_id,
      visitId: row.visit_id,
      appUrl: appUrl(),
      startsAt: new Date(row.starts_at).toISOString(),
      endsAt: new Date(row.ends_at).toISOString(),
      timeZone: TZ,
      visitStatus: row.status as VisitStatus,
      reminderMinutes: row.reminders_minutes ?? [60],
      ...(row.address
        ? { address: { formatted: row.address, verified: row.address_verified === true } }
        : {}),
      ...(row.contact_name
        ? {
            primaryContact: {
              name: row.contact_name,
              ...(row.contact_role ? { role: row.contact_role } : {}),
              ...(row.contact_phone ? { phone: row.contact_phone } : {}),
            },
          }
        : {}),
      ...(row.objective ? { objective: row.objective } : {}),
      ...(row.product_name ? { product: row.product_name } : {}),
      ...(row.important_info ? { operationalInfo: row.important_info } : {}),
    },
  );
}

interface LinkRow {
  id: string;
  visit_id: string;
  task_id: string | null;
  connection_id: string | null;
  calendar_id: string;
  google_event_id: string;
  etag: string | null;
  google_updated_at: string | null;
  content_hash: string | null;
  last_change_origin: string;
  last_synced_at: string | null;
  status: string;
  last_error: string | null;
}

function toLink(row: LinkRow | null): CalendarEventLink | null {
  if (!row) return null;
  return {
    visitId: row.visit_id,
    ...(row.task_id ? { taskId: row.task_id } : {}),
    calendarId: row.calendar_id,
    googleEventId: row.google_event_id,
    ...(row.etag ? { etag: row.etag } : {}),
    ...(row.google_updated_at
      ? { googleUpdatedAt: new Date(row.google_updated_at).toISOString() }
      : {}),
    ...(row.content_hash ? { contentHash: row.content_hash } : {}),
    lastChangeOrigin: row.last_change_origin as CalendarEventLink['lastChangeOrigin'],
    ...(row.last_synced_at ? { lastSyncedAt: new Date(row.last_synced_at).toISOString() } : {}),
    status: row.status as CalendarEventLink['status'],
    ...(row.last_error ? { lastError: row.last_error } : {}),
  };
}

// ---------------------------------------------------------------------------
// CRM → provider
// ---------------------------------------------------------------------------

export interface SyncReport {
  readonly visitId: string;
  readonly outcome:
    | 'CREAT'
    | 'ACTUALITZAT'
    | 'SENSE CANVIS'
    | 'APLICAT AL CRM'
    | 'CANCEL·LADA AL CRM'
    | 'PERDUT'
    | 'CONFLICTE'
    | 'DESACTIVAT'
    | 'ERROR';
  readonly message: string;
  readonly audit?: SyncAuditRecord;
}

/**
 * Pushes one visit. Save in the CRM first, then write to the calendar.
 *
 * Idempotent by construction: the remote is read before writing, the decision
 * comes from `reconcile`, and a transient failure only leaves `status = ERROR`
 * on the link so the next resync retries the same operation.
 */
export async function pushVisit(visitId: string, actorUserId: string): Promise<SyncReport> {
  const context = await withServiceRole(async (q) => {
    const visit = await q.one<VisitSyncRow>(VISIT_SYNC_SELECT, [visitId]);
    if (!visit) return null;
    const link = await q.one<LinkRow>(
      `select * from public.calendar_event_links where visit_id = $1`,
      [visitId],
    );
    const owner = visit.user_id ?? actorUserId;
    const connection = await q.one<ConnectionRow>(
      `select ${PUBLIC_COLUMNS} from public.google_calendar_connections
        where user_id = $1 and status <> 'DESCONNECTAT'
        order by case provider when 'google' then 0 else 1 end limit 1`,
      [owner],
    );
    const wantsSync = await q.one<{ sync_to_google: boolean }>(
      `select coalesce(t.sync_to_google, true) as sync_to_google
         from public.visits v left join public.tasks t on t.id = v.task_id
        where v.id = $1`,
      [visitId],
    );
    return { visit, link, connection, owner, wantsSync: wantsSync?.sync_to_google !== false };
  });

  if (!context?.visit) {
    return { visitId, outcome: 'ERROR', message: 'La visita ja no existeix.' };
  }
  if (!context.wantsSync) {
    return {
      visitId,
      outcome: 'DESACTIVAT',
      message: 'Aquesta visita té la sincronització desactivada.',
    };
  }

  const connection =
    context.connection ?? (await ensureConnection(context.owner, context.visit.workspace_id));
  const resolved = await resolveProvider(connection.id);
  if (!resolved) {
    return { visitId, outcome: 'ERROR', message: 'No hi ha cap calendari connectat.' };
  }

  const crm = toCrmEvent(context.visit);
  const link = toLink(context.link);

  let remote: RemoteEvent | null = null;
  if (link) {
    try {
      remote = await resolved.provider.getEvent(link.calendarId, link.googleEventId);
    } catch (error) {
      await recordLinkError(visitId, describe(error));
      return { visitId, outcome: 'ERROR', message: describe(error) };
    }
  }

  const decision = reconcile({ link, crm, remote });

  try {
    switch (decision.type) {
      case 'CREATE_REMOTE': {
        const created = await resolved.provider.createEvent(resolved.calendarId, crm);
        await saveLink(context.owner, {
          visitId,
          taskId: context.visit.task_id,
          connectionId: connection.id,
          workspaceId: context.visit.workspace_id,
          state: linkAfterPush(null, created, decision.content, new Date()),
        });
        return {
          visitId,
          outcome: 'CREAT',
          message: 'Esdeveniment creat al calendari.',
          audit: decision.audit,
        };
      }
      case 'UPDATE_REMOTE': {
        if (!link) break;
        const updated = await resolved.provider.updateEvent(
          link.calendarId,
          link.googleEventId,
          crm,
          decision.ifMatch ? { etag: decision.ifMatch } : {},
        );
        await saveLink(context.owner, {
          visitId,
          taskId: context.visit.task_id,
          connectionId: connection.id,
          workspaceId: context.visit.workspace_id,
          state: linkAfterPush(link, updated, decision.content, new Date()),
        });
        return {
          visitId,
          outcome: 'ACTUALITZAT',
          message: 'Esdeveniment actualitzat al calendari.',
          audit: decision.audit,
        };
      }
      case 'APPLY_TO_CRM': {
        await applyRemoteToCrm(context.owner, context.visit, decision.content);
        if (link && remote) {
          await saveLink(context.owner, {
            visitId,
            taskId: context.visit.task_id,
            connectionId: connection.id,
            workspaceId: context.visit.workspace_id,
            state: linkAfterPull(link, remote, decision.content, new Date()),
          });
        }
        return {
          visitId,
          outcome: 'APLICAT AL CRM',
          message: decision.audit.reason,
          audit: decision.audit,
        };
      }
      case 'CANCEL_VISIT_IN_CRM': {
        await cancelFromGoogle(context.owner, visitId);
        if (link && remote) {
          await saveLink(context.owner, {
            visitId,
            taskId: context.visit.task_id,
            connectionId: connection.id,
            workspaceId: context.visit.workspace_id,
            state: linkAfterPull(link, remote, remoteToContent(remote, TZ), new Date()),
          });
        }
        return {
          visitId,
          outcome: 'CANCEL·LADA AL CRM',
          message: decision.audit.reason,
          audit: decision.audit,
        };
      }
      case 'REMOTE_GONE': {
        await recordLinkError(
          visitId,
          'L’esdeveniment ja no existeix al calendari; la visita es manté al CRM.',
        );
        return { visitId, outcome: 'PERDUT', message: decision.audit.reason, audit: decision.audit };
      }
      case 'CONFLICT': {
        await recordLinkError(visitId, decision.report.message);
        return {
          visitId,
          outcome: 'CONFLICTE',
          message: decision.report.message,
          audit: decision.audit,
        };
      }
      default:
        break;
    }
  } catch (error) {
    await recordLinkError(visitId, describe(error));
    return { visitId, outcome: 'ERROR', message: describe(error) };
  }

  return {
    visitId,
    outcome: 'SENSE CANVIS',
    message: decision.audit.reason,
    audit: decision.audit,
  };
}

/** Marks the link PENDENT so a failed push is visible and retried. */
export async function queueVisitSync(visitId: string): Promise<void> {
  await withServiceRole((q) =>
    q.run(
      `update public.calendar_event_links set status = 'PENDENT' where visit_id = $1`,
      [visitId],
    ),
  );
}

interface SaveLinkInput {
  visitId: string;
  taskId: string | null;
  connectionId: string;
  workspaceId: string;
  state: CalendarEventLink;
}

async function saveLink(actorUserId: string, input: SaveLinkInput): Promise<void> {
  const { state } = input;
  await withUser(actorUserId, (q) =>
    q.run(
      `insert into public.calendar_event_links
         (workspace_id, connection_id, visit_id, task_id, calendar_id, google_event_id,
          etag, google_updated_at, content_hash, last_change_origin, last_synced_at, status, last_error)
       values ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9, $10::app.change_origin,
               $11::timestamptz, $12::app.sync_status, null)
       on conflict (visit_id) do update
         set connection_id = excluded.connection_id,
             task_id = excluded.task_id,
             calendar_id = excluded.calendar_id,
             google_event_id = excluded.google_event_id,
             etag = excluded.etag,
             google_updated_at = excluded.google_updated_at,
             content_hash = excluded.content_hash,
             last_change_origin = excluded.last_change_origin,
             last_synced_at = excluded.last_synced_at,
             status = excluded.status,
             last_error = null`,
      [
        input.workspaceId,
        input.connectionId,
        input.visitId,
        input.taskId,
        state.calendarId,
        state.googleEventId,
        state.etag ?? null,
        state.googleUpdatedAt ?? null,
        state.contentHash ?? null,
        state.lastChangeOrigin,
        state.lastSyncedAt ?? new Date().toISOString(),
        state.status,
      ],
    ),
  );
}

async function recordLinkError(visitId: string, message: string): Promise<void> {
  await withServiceRole((q) =>
    q.run(
      `update public.calendar_event_links
          set status = 'ERROR', last_error = $2 where visit_id = $1`,
      [visitId, message.slice(0, 500)],
    ),
  );
}

// ---------------------------------------------------------------------------
// Provider → CRM
// ---------------------------------------------------------------------------

/**
 * Applies an incoming change to the visit and its paired task.
 *
 * Runs as the visit's owner with `origin = GOOGLE CALENDAR`, so the audit
 * trigger records where the change came from. **It never calls a push**: the
 * link's `content_hash` is set to the hash of what was applied, which is what
 * makes the next planner say `ALREADY_CONVERGED`.
 */
async function applyRemoteToCrm(
  ownerId: string,
  visit: VisitSyncRow,
  content: EventContent,
): Promise<void> {
  const starts = new Date(content.startsAt);
  const ends = new Date(content.endsAt);
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime()) || ends <= starts) return;
  const minutes = Math.max(5, Math.min(1440, Math.round((+ends - +starts) / 60000)));

  await withUser(
    ownerId,
    async (q) => {
      await q.run(
        `update public.visits
            set starts_at = $2::timestamptz, ends_at = $3::timestamptz
          where id = $1 and deleted_at is null`,
        [visit.visit_id, starts.toISOString(), ends.toISOString()],
      );
      if (visit.task_id) {
        await q.run(
          `update public.tasks set due_at = $2::timestamptz, duration_minutes = $3
            where id = $1 and deleted_at is null and status = 'PENDENT'`,
          [visit.task_id, starts.toISOString(), minutes],
        );
      }
    },
    { origin: 'GOOGLE CALENDAR' },
  );
}

/** Deleting the event in Google cancels the visit. It never deletes history. */
async function cancelFromGoogle(ownerId: string, visitId: string): Promise<void> {
  await withUser(
    ownerId,
    (q) =>
      q.run(
        `select app.cancel_visit($1, $2, 'GOOGLE CALENDAR'::app.change_origin)`,
        [visitId, 'Esdeveniment esborrat o cancel·lat des de Google Calendar.'],
      ),
    { origin: 'GOOGLE CALENDAR' },
  );
}

export interface PullReport {
  readonly connectionId: string;
  readonly examined: number;
  readonly applied: number;
  readonly ignored: number;
  readonly reports: readonly SyncReport[];
  readonly fullResync: boolean;
  readonly error?: string;
}

/**
 * Incremental Google → CRM synchronisation.
 *
 * The visit is found through the event's **private extended properties**
 * (`crmVisitId`), never through the title: a user is free to rename an event
 * and a colleague's unrelated event must never be mistaken for a CRM visit.
 */
export async function pullChanges(connectionId: string): Promise<PullReport> {
  const secrets = await readSecrets(connectionId);
  if (!secrets) {
    return {
      connectionId,
      examined: 0,
      applied: 0,
      ignored: 0,
      reports: [],
      fullResync: false,
      error: 'Connexió desconeguda.',
    };
  }
  const resolved = await resolveProvider(connectionId);
  if (!resolved) {
    return {
      connectionId,
      examined: 0,
      applied: 0,
      ignored: 0,
      reports: [],
      fullResync: false,
      error: 'No s’ha pogut obrir el proveïdor de calendari.',
    };
  }

  const storedToken = open(secrets.sync_token) ?? secrets.sync_token ?? undefined;
  let fullResync = false;
  let changes: ChangeList;
  try {
    changes = await resolved.provider.listChanged({
      calendarId: resolved.calendarId,
      ...(storedToken ? { syncToken: storedToken } : {}),
      workspaceId: secrets.workspace_id,
    });
  } catch (error) {
    if (error instanceof SyncTokenInvalidError) {
      fullResync = true;
      changes = await resolved.provider.listChanged({
        calendarId: resolved.calendarId,
        workspaceId: secrets.workspace_id,
      });
    } else {
      await markConnectionError(connectionId, describe(error));
      return {
        connectionId,
        examined: 0,
        applied: 0,
        ignored: 0,
        reports: [],
        fullResync: false,
        error: describe(error),
      };
    }
  }

  const reports: SyncReport[] = [];
  let ignored = 0;

  for (const remote of changes.events) {
    const visitId = remote.identity.crmVisitId;
    // No CRM identity ⇒ someone's personal appointment. Never touched, never
    // shown to a manager, never imported.
    if (!visitId) {
      ignored += 1;
      continue;
    }
    const report = await applyRemoteEvent(connectionId, visitId, remote);
    reports.push(report);
  }

  if (changes.nextSyncToken) {
    await withServiceRole((q) =>
      q.run(
        `update public.google_calendar_connections
            set sync_token = $2, last_sync_at = now(), last_error = null where id = $1`,
        [connectionId, safeSeal(changes.nextSyncToken as string)],
      ),
    );
  } else {
    await withServiceRole((q) =>
      q.run(`update public.google_calendar_connections set last_sync_at = now() where id = $1`, [
        connectionId,
      ]),
    );
  }

  return {
    connectionId,
    examined: changes.events.length,
    applied: reports.filter((r) => r.outcome !== 'SENSE CANVIS').length,
    ignored,
    reports,
    fullResync,
  };
}

/**
 * Reconciles a single incoming event.
 *
 * Note what is missing: there is no branch that writes back to the provider.
 * A pull can only end in NOOP, APPLY_TO_CRM or CANCEL_VISIT_IN_CRM.
 */
async function applyRemoteEvent(
  connectionId: string,
  visitId: string,
  remote: RemoteEvent,
): Promise<SyncReport> {
  const context = await withServiceRole(async (q) => {
    const visit = await q.one<VisitSyncRow>(VISIT_SYNC_SELECT, [visitId]);
    const link = await q.one<LinkRow>(
      `select * from public.calendar_event_links where visit_id = $1`,
      [visitId],
    );
    return { visit, link };
  });
  if (!context.visit) {
    return { visitId, outcome: 'PERDUT', message: 'La visita referenciada ja no existeix.' };
  }

  const owner = context.visit.user_id;
  if (!owner) {
    return { visitId, outcome: 'ERROR', message: 'La visita no té cap comercial assignat.' };
  }

  const crm = toCrmEvent(context.visit);
  const link = toLink(context.link);
  const decision = reconcile({ link, crm, remote });

  switch (decision.type) {
    case 'APPLY_TO_CRM': {
      await applyRemoteToCrm(owner, context.visit, decision.content);
      if (link) {
        await saveLink(owner, {
          visitId,
          taskId: context.visit.task_id,
          connectionId,
          workspaceId: context.visit.workspace_id,
          state: linkAfterPull(link, remote, decision.content, new Date()),
        });
      }
      return {
        visitId,
        outcome: 'APLICAT AL CRM',
        message: decision.audit.reason,
        audit: decision.audit,
      };
    }
    case 'CANCEL_VISIT_IN_CRM': {
      await cancelFromGoogle(owner, visitId);
      if (link) {
        await saveLink(owner, {
          visitId,
          taskId: context.visit.task_id,
          connectionId,
          workspaceId: context.visit.workspace_id,
          state: linkAfterPull(link, remote, remoteToContent(remote, TZ), new Date()),
        });
      }
      return {
        visitId,
        outcome: 'CANCEL·LADA AL CRM',
        message: decision.audit.reason,
        audit: decision.audit,
      };
    }
    case 'CONFLICT': {
      await recordLinkError(visitId, decision.report.message);
      return {
        visitId,
        outcome: 'CONFLICTE',
        message: decision.report.message,
        audit: decision.audit,
      };
    }
    default:
      // UPDATE_REMOTE / CREATE_REMOTE are deliberately NOT executed here.
      // Pulling must never trigger a write back to the provider: that is the
      // echo loop this whole design exists to prevent.
      return {
        visitId,
        outcome: 'SENSE CANVIS',
        message: decision.audit.reason,
        audit: decision.audit,
      };
  }
}

function safeSeal(value: string): string {
  try {
    return seal(value);
  } catch {
    // Without APP_ENCRYPTION_KEY the sync token is stored as-is. It is an
    // opaque cursor, not a credential, and the local provider is the only
    // thing that issues one in that configuration.
    return value;
  }
}

// ---------------------------------------------------------------------------
// Watch channels + webhook
// ---------------------------------------------------------------------------

export async function openWatchChannel(connectionId: string): Promise<string | null> {
  const resolved = await resolveProvider(connectionId);
  if (!resolved) return null;
  const webhook =
    envValue('GOOGLE_CALENDAR_WEBHOOK_URL') || `${appUrl()}/api/google/webhook`;
  try {
    const channel = await resolved.provider.watch(resolved.calendarId, webhook);
    await withServiceRole((q) =>
      q.run(
        `insert into public.calendar_watch_channels
           (workspace_id, connection_id, channel_id, resource_id, verification_token, expires_at, status)
         values ($1, $2, $3, $4, $5, $6::timestamptz, 'ACTIU')
         on conflict (channel_id) do update
           set expires_at = excluded.expires_at, status = 'ACTIU'`,
        [
          resolved.connection.workspace_id,
          connectionId,
          channel.channelId,
          channel.resourceId,
          safeSeal(channel.verificationToken),
          channel.expiresAt,
        ],
      ),
    );
    return channel.channelId;
  } catch (error) {
    await markConnectionError(connectionId, describe(error));
    return null;
  }
}

export async function closeWatchChannels(connectionId: string): Promise<void> {
  const channels = await withServiceRole((q) =>
    q.many<{ channel_id: string; resource_id: string }>(
      `select channel_id, resource_id from public.calendar_watch_channels
        where connection_id = $1 and status = 'ACTIU'`,
      [connectionId],
    ),
  );
  const resolved = await resolveProvider(connectionId);
  for (const channel of channels) {
    try {
      await resolved?.provider.stopWatch({
        channelId: channel.channel_id,
        resourceId: channel.resource_id,
      });
    } catch {
      /* stopping an unknown channel must never block a disconnect */
    }
  }
  await withServiceRole((q) =>
    q.run(
      `update public.calendar_watch_channels set status = 'TANCAT' where connection_id = $1`,
      [connectionId],
    ),
  );
}

/**
 * Reopens channels that are close to expiring.
 *
 * A lapsed channel stops delivering silently; the first symptom would be a user
 * asking why a calendar edit never arrived. Called by the resync endpoint, which
 * a cron can hit.
 */
export async function renewExpiringChannels(): Promise<{ renewed: number; expired: number }> {
  const rows = await withServiceRole((q) =>
    q.many<{
      channel_id: string;
      resource_id: string;
      connection_id: string;
      expires_at: string;
      status: string;
      calendar_id: string | null;
    }>(
      `select w.channel_id, w.resource_id, w.connection_id, w.expires_at, w.status, c.calendar_id
         from public.calendar_watch_channels w
         join public.google_calendar_connections c on c.id = w.connection_id
        where w.status = 'ACTIU'`,
    ),
  );
  const plan = renewalPlan(
    rows.map((r) => ({
      channelId: r.channel_id,
      resourceId: r.resource_id,
      calendarId: r.calendar_id ?? 'primary',
      connectionId: r.connection_id,
      expiresAt: new Date(r.expires_at).toISOString(),
      status: r.status as 'ACTIU',
    })),
    new Date(),
  );

  for (const channel of [...plan.toRenew, ...plan.expired]) {
    if (!channel.connectionId) continue;
    await openWatchChannel(channel.connectionId);
    const resolved = await resolveProvider(channel.connectionId);
    try {
      await resolved?.provider.stopWatch({
        channelId: channel.channelId,
        resourceId: channel.resourceId,
      });
    } catch {
      /* best effort */
    }
    await withServiceRole((q) =>
      q.run(`update public.calendar_watch_channels set status = 'CADUCAT' where channel_id = $1`, [
        channel.channelId,
      ]),
    );
  }
  return { renewed: plan.toRenew.length, expired: plan.expired.length };
}

export type NotificationResult =
  | { readonly status: 200; readonly outcome: string }
  | { readonly status: 202; readonly outcome: string }
  | { readonly status: 401 | 404; readonly outcome: string };

/**
 * The whole webhook contract, so the same code path serves a real Google
 * notification and a locally generated one.
 */
export async function processNotification(headers: HeaderBag): Promise<NotificationResult> {
  const stored = await withServiceRole((q) =>
    q.many<{ channel_id: string; verification_token: string; resource_id: string; connection_id: string }>(
      `select channel_id, verification_token, resource_id, connection_id
         from public.calendar_watch_channels where status = 'ACTIU'`,
    ),
  );

  const verification = verifyChannel(
    headers,
    stored.map((c) => ({
      channelId: c.channel_id,
      verificationToken: open(c.verification_token) ?? c.verification_token,
      resourceId: c.resource_id,
    })),
  );

  if (!verification.ok) {
    // Every rejection is recorded: a burst of INVALID_TOKEN is an attack, and
    // an unrecorded rejection is invisible.
    await withServiceRole((q) =>
      q.run(
        `insert into public.calendar_sync_events (channel_id, outcome, error, processed_at)
         values ($1, $2, $3, now())`,
        [null, `REBUTJAT ${verification.reason}`, verification.message],
      ),
    );
    return {
      status: verification.reason === 'UNKNOWN_CHANNEL' ? 404 : 401,
      outcome: verification.message,
    };
  }

  const { notification } = verification;
  const channel = stored.find((c) => c.channel_id === notification.channelId);
  if (!channel) return { status: 404, outcome: 'Canal desconegut.' };

  // Idempotency: the unique index on (channel_id, message_number) is the
  // durable guard. A replay inserts nothing and does nothing.
  const accepted = await withServiceRole((q) =>
    q.one<{ id: string }>(
      `insert into public.calendar_sync_events (channel_id, resource_id, message_number)
       values ($1, $2, $3)
       on conflict (channel_id, message_number) where message_number is not null
       do nothing
       returning id::text as id`,
      [notification.channelId, notification.resourceId, notification.messageNumber ?? null],
    ),
  );
  if (!accepted) {
    return { status: 200, outcome: 'Avís repetit: ja s’havia processat.' };
  }

  await withServiceRole((q) =>
    q.run(
      `update public.calendar_watch_channels
          set last_message_at = now(), last_message_number = $2 where channel_id = $1`,
      [notification.channelId, notification.messageNumber ?? null],
    ),
  );

  // The opening `sync` notification carries no change.
  if (notification.resourceState === 'sync') {
    await finishSyncEvent(accepted.id, 'SINCRONITZACIÓ INICIAL', null);
    return { status: 200, outcome: 'Canal obert correctament.' };
  }

  try {
    const report = await pullChanges(channel.connection_id);
    const summary =
      `examinats ${report.examined}, aplicats ${report.applied}, ` +
      `ignorats (sense identitat CRM) ${report.ignored}` +
      (report.fullResync ? ', amb resincronització completa' : '');
    await finishSyncEvent(accepted.id, summary, report.error ?? null);
    return { status: 200, outcome: summary };
  } catch (error) {
    await finishSyncEvent(accepted.id, 'ERROR', describe(error));
    return { status: 202, outcome: describe(error) };
  }
}

async function finishSyncEvent(
  id: string,
  outcome: string,
  error: string | null,
): Promise<void> {
  await withServiceRole((q) =>
    q.run(
      `update public.calendar_sync_events
          set processed_at = now(), outcome = $2, error = $3 where id = $1::bigint`,
      [id, outcome.slice(0, 500), error?.slice(0, 500) ?? null],
    ),
  );
}

/**
 * Drains the local provider's pending notifications through the real webhook
 * path. This is what makes "everything works without Google credentials"
 * literally true rather than a claim: the same `processNotification` runs.
 */
export async function drainLocalNotifications(): Promise<NotificationResult[]> {
  const notifications = localProvider().drainNotifications();
  const results: NotificationResult[] = [];
  for (const raw of notifications) {
    results.push(await processNotification(raw as unknown as Record<string, string>));
  }
  return results;
}

// ---------------------------------------------------------------------------
// Reconciliation of everything (recovers missed notifications)
// ---------------------------------------------------------------------------

export interface ReconciliationReport {
  readonly pushed: readonly SyncReport[];
  readonly pull: PullReport | null;
  readonly channels: { renewed: number; expired: number };
  readonly localNotifications: number;
}

/**
 * Full reconciliation for one user: renew channels, replay any local
 * notification, pull, then push everything still marked PENDENT or ERROR.
 * Safe to run repeatedly — every step is idempotent.
 */
export async function reconcileUser(
  userId: string,
  workspaceId: string,
): Promise<ReconciliationReport> {
  const connection = await ensureConnection(userId, workspaceId);
  const channels = await renewExpiringChannels();
  const local = await drainLocalNotifications();
  const pull = await pullChanges(connection.id);

  const pending = await withServiceRole((q) =>
    q.many<{ visit_id: string }>(
      `select v.id as visit_id
         from public.visits v
         left join public.calendar_event_links l on l.visit_id = v.id
        where v.workspace_id = $1 and v.user_id = $2 and v.deleted_at is null
          and v.status <> 'CANCEL·LADA'
          and v.starts_at > now() - interval '30 days'
          and (l.id is null or l.status in ('PENDENT', 'ERROR', 'NO SINCRONITZAT'))
        order by v.starts_at limit 100`,
      [workspaceId, userId],
    ),
  );

  const pushed: SyncReport[] = [];
  for (const row of pending) {
    pushed.push(await pushVisit(row.visit_id, userId));
  }

  return { pushed, pull, channels, localNotifications: local.length };
}

// ---------------------------------------------------------------------------
// Calendar selection / disconnection
// ---------------------------------------------------------------------------

export async function listCalendars(connectionId: string) {
  const resolved = await resolveProvider(connectionId);
  if (!resolved) return [];
  try {
    return await resolved.provider.listCalendars();
  } catch (error) {
    await markConnectionError(connectionId, describe(error));
    return [];
  }
}

export async function createDedicatedCalendar(connectionId: string): Promise<string | null> {
  const resolved = await resolveProvider(connectionId);
  if (!resolved) return null;
  const created = await resolved.provider.createCalendar(DEDICATED_CALENDAR_NAME);
  await setCalendar(connectionId, created.id, created.summary);
  return created.id;
}

export async function setCalendar(
  connectionId: string,
  calendarId: string,
  calendarName: string,
): Promise<void> {
  await closeWatchChannels(connectionId);
  await withServiceRole((q) =>
    q.run(
      `update public.google_calendar_connections
          set calendar_id = $2, calendar_name = $3, sync_token = null, last_error = null
        where id = $1`,
      [connectionId, calendarId, calendarName],
    ),
  );
  await openWatchChannel(connectionId);
}

export async function disconnect(connectionId: string): Promise<void> {
  await closeWatchChannels(connectionId);
  await withServiceRole((q) =>
    q.run(
      `update public.google_calendar_connections
          set status = 'DESCONNECTAT', disconnected_at = now(),
              access_token_enc = null, refresh_token_enc = null, sync_token = null
        where id = $1`,
      [connectionId],
    ),
  );
}

// ---------------------------------------------------------------------------
// OAuth state
// ---------------------------------------------------------------------------

export function newOAuthState(userId: string): string {
  return `${userId}.${randomUUID()}`;
}

export function readOAuthState(state: string): string | null {
  const [userId] = state.split('.');
  return userId && userId.length > 0 ? userId : null;
}

// ---------------------------------------------------------------------------

export function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
}

/** Exposed so a page can show what the CRM would send, without pushing. */
export async function previewEvent(q: Query, visitId: string): Promise<EventContent | null> {
  const visit = await q.one<VisitSyncRow>(VISIT_SYNC_SELECT, [visitId]);
  if (!visit) return null;
  return crmToContent(toCrmEvent(visit));
}

export { contentHash };
