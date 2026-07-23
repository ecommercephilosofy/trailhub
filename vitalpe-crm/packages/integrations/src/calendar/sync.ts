/**
 * Loop-free bidirectional reconciliation.
 *
 * Everything in this file is pure: no clock unless you pass one, no network,
 * no database. That is what makes "a change pulled from Google is never echoed
 * back to Google" a property you can assert in a unit test instead of hoping
 * for it in production.
 *
 * The rules, in order of precedence:
 *
 *  1. A cancellation on the provider cancels the visit in the CRM. It never
 *     deletes it — a deleted visit takes its history with it.
 *  2. If the two sides already hash the same, do nothing. This single check is
 *     what kills echo loops: after applying a pull, the CRM content hashes to
 *     exactly what Google holds, so the next push planner has nothing to say.
 *  3. Push only when the CRM content hash changed against the stored hash.
 *  4. Pull only when the ETag/updated marker moved **and** the incoming content
 *     differs from the stored hash. A touched-but-identical event is noise.
 *  5. When both sides moved, the newer timestamp wins (with an audit record).
 *     When they moved at the same time and disagree, produce a ConflictReport
 *     and let a human decide.
 */
import { createHash } from 'node:crypto';
import type {
  ChangeOrigin,
  ConflictReport,
  CrmEvent,
  EventContent,
  RemoteEvent,
  SyncStatus,
  VisitStatus,
} from './types';

// ---------------------------------------------------------------------------
// Link state (mirrors public.calendar_event_links)
// ---------------------------------------------------------------------------

export interface CalendarEventLink {
  readonly visitId: string;
  readonly taskId?: string;
  readonly calendarId: string;
  readonly googleEventId: string;
  readonly etag?: string;
  /** ISO-8601 instant of the provider's last modification we know about. */
  readonly googleUpdatedAt?: string;
  /** Hash of the payload last pushed or pulled. Equal hash ⇒ no echo. */
  readonly contentHash?: string;
  readonly lastChangeOrigin: ChangeOrigin;
  readonly lastSyncedAt?: string;
  readonly status: SyncStatus;
  readonly lastError?: string;
}

// ---------------------------------------------------------------------------
// Content hashing
// ---------------------------------------------------------------------------

/** Exactly the fields that are synchronised. Nothing else feeds the hash. */
export const SYNCED_FIELDS = [
  'title',
  'location',
  'description',
  'startsAt',
  'endsAt',
  'timeZone',
  'status',
  'reminderMinutes',
] as const;

export type SyncedField = (typeof SYNCED_FIELDS)[number];

/** Normalises an instant so `+02:00` and its UTC equivalent hash the same. */
function normaliseInstant(value: string | undefined): string {
  if (!value) return '';
  // All-day events arrive as `YYYY-MM-DD`; keep them verbatim.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value.trim() : new Date(parsed).toISOString();
}

function normaliseText(value: string | undefined): string {
  if (value === undefined || value === null) return '';
  // Google normalises CRLF to LF and trims trailing whitespace on round-trip;
  // do the same before hashing or every pull would look like a change.
  return value.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
}

/** Deterministic projection of the synced fields, in a fixed key order. */
export function normaliseContent(content: EventContent): Record<SyncedField, unknown> {
  return {
    title: normaliseText(content.title),
    location: normaliseText(content.location),
    description: normaliseText(content.description),
    startsAt: normaliseInstant(content.startsAt),
    endsAt: normaliseInstant(content.endsAt),
    timeZone: normaliseText(content.timeZone) || 'Europe/Madrid',
    status: content.status,
    reminderMinutes: [...(content.reminderMinutes ?? [])].sort((a, b) => a - b),
  };
}

/**
 * Stable hash of the synced fields only.
 *
 * Built from an explicit key order rather than `JSON.stringify(object)` so a
 * refactor that reorders the interface cannot silently invalidate every
 * stored hash and trigger a workspace-wide false-positive resync.
 */
export function contentHash(content: EventContent): string {
  const normalised = normaliseContent(content);
  const stable = SYNCED_FIELDS.map((field) => [field, normalised[field]]);
  return createHash('sha256').update(JSON.stringify(stable), 'utf8').digest('hex');
}

/** Fields whose normalised value differs between two contents. */
export function diffFields(a: EventContent, b: EventContent): SyncedField[] {
  const left = normaliseContent(a);
  const right = normaliseContent(b);
  return SYNCED_FIELDS.filter(
    (field) => JSON.stringify(left[field]) !== JSON.stringify(right[field]),
  );
}

// ---------------------------------------------------------------------------
// Section 22.5 — what a calendar event is allowed to say
// ---------------------------------------------------------------------------

/**
 * The *only* inputs the event builder reads.
 *
 * A calendar entry syncs to a third party and often to a shared screen. It
 * carries what the commercial needs in front of the client and nothing more:
 * no transcripts, no commercial history, no credentials, no personal data
 * beyond the working contact for this visit.
 */
export interface EventContentInput {
  readonly companyName: string;
  readonly clientId: string;
  readonly visitId: string;
  /** `NEXT_PUBLIC_APP_URL`; used to build the deep link. */
  readonly appUrl: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timeZone?: string;
  readonly visitStatus?: VisitStatus;
  readonly reminderMinutes?: readonly number[];
  /** Only a *verified* address becomes the event location. */
  readonly address?: { readonly formatted: string; readonly verified: boolean };
  readonly primaryContact?: {
    readonly name: string;
    readonly role?: string;
    readonly phone?: string;
  };
  readonly objective?: string;
  readonly product?: string;
  /** Short operational note ("mostres a recollir al magatzem"). Truncated. */
  readonly operationalInfo?: string;
}

export const OPERATIONAL_INFO_MAX = 280;

export function visitDeepLink(appUrl: string, clientId: string, visitId: string): string {
  const base = appUrl.replace(/\/+$/, '');
  return `${base}/clients/${encodeURIComponent(clientId)}/visits/${encodeURIComponent(visitId)}`;
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function mapVisitStatus(status: VisitStatus | undefined): EventContent['status'] {
  switch (status) {
    case 'CANCEL·LADA':
      return 'CANCELLED';
    case 'CONFIRMADA':
    case 'FETA':
      return 'CONFIRMED';
    case 'PLANIFICADA':
    default:
      return 'TENTATIVE';
  }
}

/**
 * Builds the event body for a visit, per section 22.5.
 *
 * Title is `VISITA — <EMPRESA>`; the company name is never used to *find* the
 * event (that is what the private extended properties are for), only to
 * display it.
 */
export function buildEventContent(input: EventContentInput): EventContent {
  const company = input.companyName.trim().toUpperCase();
  const lines: string[] = [];

  if (input.primaryContact?.name) {
    const role = input.primaryContact.role?.trim();
    lines.push(`Contacte: ${input.primaryContact.name.trim()}${role ? ` (${role})` : ''}`);
  }
  if (input.primaryContact?.phone) {
    lines.push(`Telèfon: ${input.primaryContact.phone.trim()}`);
  }
  if (input.objective) {
    lines.push(`Objectiu: ${truncate(input.objective, OPERATIONAL_INFO_MAX)}`);
  }
  if (input.product) {
    lines.push(`Producte: ${input.product.trim()}`);
  }
  if (input.operationalInfo) {
    lines.push(`Informació operativa: ${truncate(input.operationalInfo, OPERATIONAL_INFO_MAX)}`);
  }
  lines.push('');
  lines.push(`Fitxa de la visita: ${visitDeepLink(input.appUrl, input.clientId, input.visitId)}`);

  const location =
    input.address && input.address.verified && input.address.formatted.trim().length > 0
      ? input.address.formatted.trim()
      : undefined;

  return {
    title: `VISITA — ${company}`,
    ...(location === undefined ? {} : { location }),
    description: lines.join('\n').trim(),
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    timeZone: input.timeZone ?? 'Europe/Madrid',
    status: mapVisitStatus(input.visitStatus),
    reminderMinutes: input.reminderMinutes ?? [60],
  };
}

/** Full CRM event = identity + section-22.5 content. */
export function buildCrmEvent(
  identity: { workspaceId: string; clientId: string; visitId: string; taskId?: string; updatedAt?: string },
  input: EventContentInput,
): CrmEvent {
  return {
    workspaceId: identity.workspaceId,
    clientId: identity.clientId,
    visitId: identity.visitId,
    ...(identity.taskId === undefined ? {} : { taskId: identity.taskId }),
    ...(identity.updatedAt === undefined ? {} : { updatedAt: identity.updatedAt }),
    ...buildEventContent(input),
  };
}

// ---------------------------------------------------------------------------
// Remote → content
// ---------------------------------------------------------------------------

export function remoteToContent(
  remote: RemoteEvent,
  fallbackTimeZone = 'Europe/Madrid',
): EventContent {
  const start = remote.start?.dateTime ?? remote.start?.date ?? '';
  const end = remote.end?.dateTime ?? remote.end?.date ?? '';
  const location = remote.location?.trim();
  return {
    title: remote.summary ?? '',
    ...(location ? { location } : {}),
    description: remote.description ?? '',
    startsAt: start,
    endsAt: end,
    timeZone: remote.start?.timeZone ?? remote.end?.timeZone ?? fallbackTimeZone,
    status:
      remote.status === 'cancelled'
        ? 'CANCELLED'
        : remote.status === 'tentative'
          ? 'TENTATIVE'
          : 'CONFIRMED',
    // The provider's reminder overrides are not part of the synced payload:
    // the CRM owns reminders, and pulling them back would fight the user.
    reminderMinutes: [],
  };
}

/** Strips identity/bookkeeping so a CrmEvent can be compared as content. */
export function crmToContent(event: CrmEvent): EventContent {
  const location = event.location;
  return {
    title: event.title,
    ...(location === undefined ? {} : { location }),
    description: event.description,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    timeZone: event.timeZone,
    status: event.status,
    // Reminders are CRM-owned (see `remoteToContent`); excluding them here
    // keeps the two sides comparable field for field.
    reminderMinutes: [],
  };
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export type SyncResolution =
  | 'FIRST_SYNC'
  | 'ADOPTED'
  | 'ALREADY_CONVERGED'
  | 'NO_CHANGE'
  | 'ONLY_CRM_CHANGED'
  | 'ONLY_GOOGLE_CHANGED'
  | 'CRM_WINS'
  | 'GOOGLE_WINS'
  | 'REMOTE_CANCELLED'
  | 'REMOTE_GONE'
  | 'SIMULTANEOUS_DIVERGENCE';

export interface SyncAuditRecord {
  readonly resolution: SyncResolution;
  readonly reason: string;
  readonly fields: readonly string[];
  readonly crmUpdatedAt?: string;
  readonly remoteUpdatedAt?: string;
}

export type SyncDecision =
  | { readonly type: 'NOOP'; readonly audit: SyncAuditRecord }
  | { readonly type: 'CREATE_REMOTE'; readonly content: EventContent; readonly audit: SyncAuditRecord }
  | {
      readonly type: 'UPDATE_REMOTE';
      readonly content: EventContent;
      /** Value for the `If-Match` header. */
      readonly ifMatch?: string;
      readonly audit: SyncAuditRecord;
    }
  | { readonly type: 'APPLY_TO_CRM'; readonly content: EventContent; readonly audit: SyncAuditRecord }
  | { readonly type: 'CANCEL_VISIT_IN_CRM'; readonly audit: SyncAuditRecord }
  | { readonly type: 'REMOTE_GONE'; readonly audit: SyncAuditRecord }
  | { readonly type: 'CONFLICT'; readonly report: ConflictReport; readonly audit: SyncAuditRecord };

export interface ReconcileInput {
  readonly link: CalendarEventLink | null;
  readonly crm: CrmEvent;
  /** `null` means the provider returned 404 for the linked event. */
  readonly remote: RemoteEvent | null;
  readonly now?: Date;
  /**
   * Two edits closer together than this are treated as simultaneous, so
   * last-write-wins is not applied to a coin flip. Default 2 s.
   */
  readonly simultaneousToleranceMs?: number;
}

const DEFAULT_TOLERANCE_MS = 2_000;

/**
 * Decides what — if anything — should happen to a single visit ⇄ event pair.
 */
export function reconcile(input: ReconcileInput): SyncDecision {
  const { link, crm, remote } = input;
  const now = input.now ?? new Date();
  const tolerance = input.simultaneousToleranceMs ?? DEFAULT_TOLERANCE_MS;
  const crmContent = crmToContent(crm);
  const crmHash = contentHash(crmContent);

  // --- No link yet -------------------------------------------------------
  if (!link) {
    if (!remote) {
      return {
        type: 'CREATE_REMOTE',
        content: crmContent,
        audit: audit('FIRST_SYNC', 'La visita encara no té esdeveniment al calendari.', []),
      };
    }
    // Adoption: an event already carries this visit's identity.
    const adoptedContent = remoteToContent(remote, crm.timeZone);
    const fields = diffFields(crmContent, adoptedContent);
    if (fields.length === 0) {
      return {
        type: 'NOOP',
        audit: audit('ADOPTED', 'S’ha adoptat un esdeveniment ja existent i idèntic.', []),
      };
    }
    return {
      type: 'UPDATE_REMOTE',
      content: crmContent,
      ...(remote.etag ? { ifMatch: remote.etag } : {}),
      audit: audit(
        'ADOPTED',
        'S’ha adoptat un esdeveniment existent i s’hi ha escrit el contingut del CRM.',
        fields,
        crm.updatedAt,
        remote.updated,
      ),
    };
  }

  // --- The remote event vanished ----------------------------------------
  if (!remote) {
    return {
      type: 'REMOTE_GONE',
      audit: audit(
        'REMOTE_GONE',
        'L’esdeveniment ja no existeix al calendari remot; cal revisar l’enllaç.',
        [],
      ),
    };
  }

  const remoteContent = remoteToContent(remote, crm.timeZone);
  const remoteHash = contentHash(remoteContent);
  const stored = link.contentHash;

  // --- Deleted or cancelled on the provider -----------------------------
  // Rule 1: a visit is cancelled, never deleted.
  if (remote.status === 'cancelled') {
    if (crm.status === 'CANCELLED') {
      return {
        type: 'NOOP',
        audit: audit('NO_CHANGE', 'La visita ja consta com a CANCEL·LADA.', []),
      };
    }
    return {
      type: 'CANCEL_VISIT_IN_CRM',
      audit: audit(
        'REMOTE_CANCELLED',
        'L’esdeveniment s’ha esborrat o cancel·lat a Google: la visita passa a CANCEL·LADA (mai s’esborra).',
        ['status'],
        crm.updatedAt,
        remote.updated,
      ),
    };
  }

  // --- Rule 2: already converged ⇒ never echo ---------------------------
  if (crmHash === remoteHash) {
    return {
      type: 'NOOP',
      audit: audit(
        'ALREADY_CONVERGED',
        link.lastChangeOrigin === 'GOOGLE CALENDAR'
          ? 'El contingut del CRM coincideix amb el que s’acaba de rebre de Google: no es reenvia res.'
          : 'Els dos costats coincideixen.',
        [],
        crm.updatedAt,
        remote.updated,
      ),
    };
  }

  const crmChanged = stored === undefined ? true : crmHash !== stored;
  const markerMoved =
    (link.etag !== undefined && remote.etag !== link.etag) ||
    (link.googleUpdatedAt !== undefined && remote.updated !== link.googleUpdatedAt) ||
    link.etag === undefined;
  const remoteChanged = markerMoved && (stored === undefined || remoteHash !== stored);

  const fields = diffFields(crmContent, remoteContent);

  // --- Rule 3: push -----------------------------------------------------
  if (crmChanged && !remoteChanged) {
    return {
      type: 'UPDATE_REMOTE',
      content: crmContent,
      ...(link.etag ? { ifMatch: link.etag } : {}),
      audit: audit('ONLY_CRM_CHANGED', 'Només ha canviat el CRM.', fields, crm.updatedAt, remote.updated),
    };
  }

  // --- Rule 4: pull -----------------------------------------------------
  if (!crmChanged && remoteChanged) {
    return {
      type: 'APPLY_TO_CRM',
      content: remoteContent,
      audit: audit(
        'ONLY_GOOGLE_CHANGED',
        'Només ha canviat Google.',
        fields,
        crm.updatedAt,
        remote.updated,
      ),
    };
  }

  if (!crmChanged && !remoteChanged) {
    return {
      type: 'NOOP',
      audit: audit('NO_CHANGE', 'Cap dels dos costats ha canviat des de l’última sincronització.', fields),
    };
  }

  // --- Rule 5: both sides moved ----------------------------------------
  const crmAt = Date.parse(crm.updatedAt ?? '');
  const remoteAt = Date.parse(remote.updated ?? '');
  const ordered = Number.isFinite(crmAt) && Number.isFinite(remoteAt);
  const delta = ordered ? crmAt - remoteAt : 0;

  if (ordered && Math.abs(delta) > tolerance) {
    if (delta > 0) {
      return {
        type: 'UPDATE_REMOTE',
        content: crmContent,
        ...(link.etag ? { ifMatch: link.etag } : {}),
        audit: audit(
          'CRM_WINS',
          'Tots dos costats han canviat; l’edició del CRM és posterior i preval.',
          fields,
          crm.updatedAt,
          remote.updated,
        ),
      };
    }
    return {
      type: 'APPLY_TO_CRM',
      content: remoteContent,
      audit: audit(
        'GOOGLE_WINS',
        'Tots dos costats han canviat; l’edició de Google és posterior i preval.',
        fields,
        crm.updatedAt,
        remote.updated,
      ),
    };
  }

  const report: ConflictReport = {
    visitId: crm.visitId,
    calendarId: link.calendarId,
    googleEventId: link.googleEventId,
    fields,
    crm: crmContent,
    remote: remoteContent,
    ...(crm.updatedAt === undefined ? {} : { crmUpdatedAt: crm.updatedAt }),
    remoteUpdatedAt: remote.updated,
    detectedAt: now.toISOString(),
    message:
      'La visita s’ha modificat alhora al CRM i a Google amb valors diferents. ' +
      `Camps en conflicte: ${fields.join(', ')}. Cal decidir quina versió es manté.`,
  };

  return {
    type: 'CONFLICT',
    report,
    audit: audit(
      'SIMULTANEOUS_DIVERGENCE',
      report.message,
      fields,
      crm.updatedAt,
      remote.updated,
    ),
  };
}

function audit(
  resolution: SyncResolution,
  reason: string,
  fields: readonly string[],
  crmUpdatedAt?: string,
  remoteUpdatedAt?: string,
): SyncAuditRecord {
  return {
    resolution,
    reason,
    fields,
    ...(crmUpdatedAt === undefined ? {} : { crmUpdatedAt }),
    ...(remoteUpdatedAt === undefined ? {} : { remoteUpdatedAt }),
  };
}

// ---------------------------------------------------------------------------
// Link bookkeeping
// ---------------------------------------------------------------------------

/** New link state after a successful CRM → provider write. */
export function linkAfterPush(
  link: CalendarEventLink | null,
  remote: RemoteEvent,
  content: EventContent,
  syncedAt: Date,
): CalendarEventLink {
  return {
    ...(link ?? {
      visitId: '',
      calendarId: remote.calendarId,
      googleEventId: remote.id,
      lastChangeOrigin: 'CRM' as ChangeOrigin,
      status: 'SINCRONITZAT' as SyncStatus,
    }),
    calendarId: remote.calendarId,
    googleEventId: remote.id,
    etag: remote.etag,
    googleUpdatedAt: remote.updated,
    contentHash: contentHash(content),
    lastChangeOrigin: 'CRM',
    lastSyncedAt: syncedAt.toISOString(),
    status: 'SINCRONITZAT',
  };
}

/**
 * New link state after applying a provider → CRM change.
 *
 * The stored hash becomes the hash of what we just applied, which is exactly
 * what makes the next push planner see "no change" and stay quiet.
 */
export function linkAfterPull(
  link: CalendarEventLink,
  remote: RemoteEvent,
  applied: EventContent,
  syncedAt: Date,
): CalendarEventLink {
  return {
    ...link,
    etag: remote.etag,
    googleUpdatedAt: remote.updated,
    contentHash: contentHash(applied),
    lastChangeOrigin: 'GOOGLE CALENDAR',
    lastSyncedAt: syncedAt.toISOString(),
    status: 'SINCRONITZAT',
  };
}
