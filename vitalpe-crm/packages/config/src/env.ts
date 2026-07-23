/**
 * Environment loading and validation.
 *
 * ## Contract
 *
 * The app boots with **only** the APP and SUPABASE groups set:
 *
 *   NEXT_PUBLIC_APP_URL, MOBILE_APP_SCHEME, APP_ENCRYPTION_KEY,
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Every other variable is optional. A missing integration variable never
 * throws: the feature degrades to its local provider (local calendar, manual
 * transcript, rule-based interpreter, null geocoder) and the admin
 * "Integracions" screen explains — in Catalan — what to set to enable it.
 *
 * ## Client / server split
 *
 * `publicEnv()` holds only values that are safe in a browser bundle.
 * `serverEnv()` holds everything, including secrets, and throws if it is ever
 * evaluated where `window` exists. Never import `serverEnv` from a client
 * component: the guard is the last line of defence, not the design.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class EnvironmentError extends Error {
  override readonly name = 'EnvironmentError';
  readonly issues: string[];

  constructor(message: string, issues: string[] = []) {
    super(issues.length > 0 ? `${message}\n  - ${issues.join('\n  - ')}` : message);
    this.issues = issues;
  }
}

export class ServerEnvOnClientError extends Error {
  override readonly name = 'ServerEnvOnClientError';

  constructor(what = 'serverEnv()') {
    super(
      `${what} s'ha intentat llegir des del navegador. Les variables de servidor ` +
        'mai poden arribar al paquet del client. Mou aquesta crida a un Server ' +
        'Component, una Route Handler o una Edge Function.',
    );
  }
}

/** Throws when running in a browser-like environment. Exported for reuse. */
export function assertServerOnly(what = 'serverEnv()'): void {
  if (typeof window !== 'undefined') throw new ServerEnvOnClientError(what);
}

// ---------------------------------------------------------------------------
// Variable catalogue — mirrors the brief's .env.example, group by group
// ---------------------------------------------------------------------------

export type EnvGroup =
  | 'APP'
  | 'SUPABASE'
  | 'GOOGLE_CALENDAR'
  | 'ANTHROPIC'
  | 'TRANSCRIPTION'
  | 'MOBILE'
  | 'GEOCODING'
  | 'OBSERVABILITY';

export interface EnvVariableSpec {
  readonly name: string;
  readonly group: EnvGroup;
  readonly required: boolean;
  /** `true` when the value may be shipped to the browser. */
  readonly public: boolean;
  /** `true` when the value must never be logged or returned by an API. */
  readonly secret: boolean;
  /** Catalan description shown in the admin "Integracions" screen. */
  readonly description: string;
}

const V = (spec: EnvVariableSpec): EnvVariableSpec => spec;

export const ENV_VARIABLES: readonly EnvVariableSpec[] = [
  // --- APP (required) ------------------------------------------------------
  V({
    name: 'NEXT_PUBLIC_APP_URL',
    group: 'APP',
    required: true,
    public: true,
    secret: false,
    description: "URL pública de l'aplicació web. S'utilitza per construir els enllaços profunds de les visites.",
  }),
  V({
    name: 'MOBILE_APP_SCHEME',
    group: 'APP',
    required: false,
    public: true,
    secret: false,
    description: "Esquema d'URL de l'app mòbil (per defecte «vitalpe»). Serveix per obrir la fitxa del client des d'una notificació.",
  }),
  V({
    name: 'APP_ENCRYPTION_KEY',
    group: 'APP',
    required: true,
    public: false,
    secret: true,
    description: 'Clau mestra (mínim 32 caràcters) per xifrar els secrets desats a la base de dades, com els tokens de Google.',
  }),

  // --- SUPABASE (required) -------------------------------------------------
  V({
    name: 'NEXT_PUBLIC_SUPABASE_URL',
    group: 'SUPABASE',
    required: true,
    public: true,
    secret: false,
    description: 'URL del projecte de Supabase.',
  }),
  V({
    name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    group: 'SUPABASE',
    required: true,
    public: true,
    secret: false,
    description: 'Clau anònima de Supabase. Només dona accés al que permetin les polítiques RLS.',
  }),
  V({
    name: 'SUPABASE_SERVICE_ROLE_KEY',
    group: 'SUPABASE',
    required: true,
    public: false,
    secret: true,
    description: 'Clau de servei de Supabase. Salta les polítiques RLS: només al servidor, mai al navegador.',
  }),

  // --- GOOGLE CALENDAR (optional) -----------------------------------------
  V({
    name: 'GOOGLE_CLIENT_ID',
    group: 'GOOGLE_CALENDAR',
    required: false,
    public: false,
    secret: false,
    description: "Identificador del client OAuth de Google Cloud amb l'API de Calendar activada.",
  }),
  V({
    name: 'GOOGLE_CLIENT_SECRET',
    group: 'GOOGLE_CALENDAR',
    required: false,
    public: false,
    secret: true,
    description: 'Secret del client OAuth de Google.',
  }),
  V({
    name: 'GOOGLE_REDIRECT_URI',
    group: 'GOOGLE_CALENDAR',
    required: false,
    public: false,
    secret: false,
    description: "URI de retorn OAuth, per exemple https://el-teu-domini/api/google/callback. Ha de coincidir exactament amb la de la consola de Google.",
  }),
  V({
    name: 'GOOGLE_CALENDAR_WEBHOOK_URL',
    group: 'GOOGLE_CALENDAR',
    required: false,
    public: false,
    secret: false,
    description: 'URL HTTPS pública on Google enviarà els avisos de canvi del calendari. Sense aquesta variable la sincronització funciona, però només per sondeig.',
  }),

  // --- ANTHROPIC (optional) ------------------------------------------------
  V({
    name: 'ANTHROPIC_API_KEY',
    group: 'ANTHROPIC',
    required: false,
    public: false,
    secret: true,
    description: "Clau de l'API d'Anthropic per interpretar les notes de veu. Sense aquesta clau s'utilitza l'intèrpret local basat en regles.",
  }),
  V({
    name: 'ANTHROPIC_MODEL',
    group: 'ANTHROPIC',
    required: false,
    public: false,
    secret: false,
    description: `Model d'Anthropic (per defecte «${'claude-opus-4-8'}»).`,
  }),

  // --- TRANSCRIPTION (optional) -------------------------------------------
  V({
    name: 'TRANSCRIPTION_PROVIDER',
    group: 'TRANSCRIPTION',
    required: false,
    public: false,
    secret: false,
    description: 'Proveïdor de transcripció: «openai» o «local». Per defecte «local», que demana enganxar la transcripció a mà.',
  }),
  V({
    name: 'OPENAI_API_KEY',
    group: 'TRANSCRIPTION',
    required: false,
    public: false,
    secret: true,
    description: "Clau de l'API d'OpenAI per transcriure l'àudio amb Whisper.",
  }),
  V({
    name: 'TRANSCRIPTION_MODEL',
    group: 'TRANSCRIPTION',
    required: false,
    public: false,
    secret: false,
    description: 'Model de transcripció (per defecte «whisper-1»).',
  }),

  // --- MOBILE (optional) ---------------------------------------------------
  V({
    name: 'EXPO_PUBLIC_API_URL',
    group: 'MOBILE',
    required: false,
    public: true,
    secret: false,
    description: "URL de l'API que utilitza l'app mòbil. Si no s'indica, s'utilitza NEXT_PUBLIC_APP_URL.",
  }),
  V({
    name: 'EXPO_PROJECT_ID',
    group: 'MOBILE',
    required: false,
    public: false,
    secret: false,
    description: "Identificador del projecte d'Expo, necessari per enviar notificacions push.",
  }),

  // --- GEOCODING (optional) ------------------------------------------------
  V({
    name: 'GEOCODING_PROVIDER',
    group: 'GEOCODING',
    required: false,
    public: false,
    secret: false,
    description: 'Proveïdor de geocodificació: «google» o «none». Per defecte «none»: les adreces queden com a PENDENT DE GEOLOCALITZAR.',
  }),
  V({
    name: 'GOOGLE_MAPS_API_KEY',
    group: 'GEOCODING',
    required: false,
    public: false,
    secret: true,
    description: "Clau de l'API de Google Maps amb Geocoding activat.",
  }),

  // --- OBSERVABILITY (optional) -------------------------------------------
  V({
    name: 'SENTRY_DSN',
    group: 'OBSERVABILITY',
    required: false,
    public: true,
    secret: false,
    description: "DSN de Sentry per recollir els errors. Si es deixa buit no s'envia res enlloc.",
  }),
] as const;

export const REQUIRED_SERVER_VARIABLES: readonly string[] = ENV_VARIABLES.filter(
  (v) => v.required,
).map((v) => v.name);

export const REQUIRED_PUBLIC_VARIABLES: readonly string[] = ENV_VARIABLES.filter(
  (v) => v.required && v.public,
).map((v) => v.name);

export const OPTIONAL_VARIABLES: readonly string[] = ENV_VARIABLES.filter(
  (v) => !v.required,
).map((v) => v.name);

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export type EnvSource = Record<string, string | undefined>;

/** Empty strings in a `.env` file mean "not set", not "set to empty". */
const optionalText = z
  .string()
  .transform((s) => s.trim())
  .transform((s) => (s.length === 0 ? undefined : s))
  .optional();

const requiredText = (label: string) =>
  z
    .string({ required_error: `${label} és obligatòria` })
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, { message: `${label} no pot estar buida` });

const urlText = (label: string) =>
  requiredText(label).refine((s) => /^https?:\/\//i.test(s), {
    message: `${label} ha de començar per http:// o https://`,
  });

const optionalUrl = optionalText.refine((s) => s === undefined || /^https?:\/\//i.test(s), {
  message: 'ha de començar per http:// o https://',
});

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-4-8';
export const DEFAULT_TRANSCRIPTION_MODEL = 'whisper-1';
export const DEFAULT_MOBILE_APP_SCHEME = 'vitalpe';

const publicSchema = z.object({
  NEXT_PUBLIC_APP_URL: urlText('NEXT_PUBLIC_APP_URL'),
  MOBILE_APP_SCHEME: optionalText.transform((s) => s ?? DEFAULT_MOBILE_APP_SCHEME),
  NEXT_PUBLIC_SUPABASE_URL: urlText('NEXT_PUBLIC_SUPABASE_URL'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: requiredText('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  EXPO_PUBLIC_API_URL: optionalUrl,
  SENTRY_DSN: optionalText,
});

const serverSchema = publicSchema.extend({
  // APP
  APP_ENCRYPTION_KEY: requiredText('APP_ENCRYPTION_KEY').refine((s) => s.length >= 32, {
    message: 'APP_ENCRYPTION_KEY ha de tenir com a mínim 32 caràcters',
  }),
  // SUPABASE
  SUPABASE_SERVICE_ROLE_KEY: requiredText('SUPABASE_SERVICE_ROLE_KEY'),
  // GOOGLE CALENDAR
  GOOGLE_CLIENT_ID: optionalText,
  GOOGLE_CLIENT_SECRET: optionalText,
  GOOGLE_REDIRECT_URI: optionalUrl,
  GOOGLE_CALENDAR_WEBHOOK_URL: optionalUrl,
  // ANTHROPIC
  ANTHROPIC_API_KEY: optionalText,
  ANTHROPIC_MODEL: optionalText.transform((s) => s ?? DEFAULT_ANTHROPIC_MODEL),
  // TRANSCRIPTION
  // An unknown value degrades to the local provider instead of refusing to
  // boot: a typo in an optional variable must never take the app down.
  TRANSCRIPTION_PROVIDER: optionalText.transform((s) =>
    (s ?? '').toLowerCase() === 'openai' ? ('openai' as const) : ('local' as const),
  ),
  OPENAI_API_KEY: optionalText,
  TRANSCRIPTION_MODEL: optionalText.transform((s) => s ?? DEFAULT_TRANSCRIPTION_MODEL),
  // MOBILE
  EXPO_PROJECT_ID: optionalText,
  // GEOCODING
  GEOCODING_PROVIDER: optionalText.transform((s) =>
    (s ?? '').toLowerCase() === 'google' ? ('google' as const) : ('none' as const),
  ),
  GOOGLE_MAPS_API_KEY: optionalText,
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
  });
}

/**
 * Validate the public half of the environment. Pure: pass any source object.
 * Safe to call from the browser.
 */
export function loadPublicEnv(source: EnvSource = readProcessEnv()): PublicEnv {
  const parsed = publicSchema.safeParse(source);
  if (!parsed.success) {
    throw new EnvironmentError(
      "Falten variables d'entorn públiques o no són vàlides.",
      formatIssues(parsed.error),
    );
  }
  return parsed.data;
}

/**
 * Validate the full environment. Server-only: throws in a browser.
 */
export function loadServerEnv(source: EnvSource = readProcessEnv()): ServerEnv {
  assertServerOnly('loadServerEnv()');
  const parsed = serverSchema.safeParse(source);
  if (!parsed.success) {
    throw new EnvironmentError(
      "Falten variables d'entorn obligatòries o no són vàlides. Amb el grup APP i el grup SUPABASE n'hi ha prou per arrencar.",
      formatIssues(parsed.error),
    );
  }
  return parsed.data;
}

function readProcessEnv(): EnvSource {
  return typeof process === 'undefined' ? {} : (process.env as EnvSource);
}

let publicCache: PublicEnv | undefined;
let serverCache: ServerEnv | undefined;

/** Cached public environment. */
export function publicEnv(): PublicEnv {
  publicCache ??= loadPublicEnv();
  return publicCache;
}

/** Cached server environment. Throws if evaluated in a browser. */
export function serverEnv(): ServerEnv {
  assertServerOnly('serverEnv()');
  serverCache ??= loadServerEnv();
  return serverCache;
}

/** Clears the memoised environments. Used by tests and by hot reload. */
export function resetEnvCache(): void {
  publicCache = undefined;
  serverCache = undefined;
}

// ---------------------------------------------------------------------------
// Integration status — feeds the admin "Integracions" screen
// ---------------------------------------------------------------------------

export type IntegrationStatus = 'CONFIGURED' | 'NOT_CONFIGURED';

export type IntegrationKey =
  | 'supabase'
  | 'googleCalendar'
  | 'googleCalendarWebhook'
  | 'transcription'
  | 'interpretation'
  | 'geocoding'
  | 'mobilePush'
  | 'errorTracking';

export interface IntegrationStatusReport {
  readonly key: IntegrationKey;
  /** Catalan label for the screen. */
  readonly label: string;
  readonly status: IntegrationStatus;
  /** Which provider is actually in use right now. */
  readonly activeProvider: string;
  /** Catalan explanation: what this gives you, or what to set to enable it. */
  readonly explanation: string;
  /** Variables still missing, in the order they should be filled in. */
  readonly missing: readonly string[];
  /** Every variable that belongs to this integration. */
  readonly variables: readonly string[];
}

function present(source: EnvSource, name: string): boolean {
  const raw = source[name];
  return typeof raw === 'string' && raw.trim().length > 0;
}

function missingFrom(source: EnvSource, names: readonly string[]): string[] {
  return names.filter((name) => !present(source, name));
}

/**
 * Per-integration configuration report.
 *
 * Never throws and never reads a secret's value — only whether it is present —
 * so it is safe to call from an admin API route and render verbatim.
 */
export function integrationStatus(
  source: EnvSource = readProcessEnv(),
): readonly IntegrationStatusReport[] {
  const reports: IntegrationStatusReport[] = [];

  // Supabase --------------------------------------------------------------
  {
    const variables = [
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
    ];
    const missing = missingFrom(source, variables);
    reports.push({
      key: 'supabase',
      label: 'Base de dades (Supabase)',
      status: missing.length === 0 ? 'CONFIGURED' : 'NOT_CONFIGURED',
      activeProvider: missing.length === 0 ? 'supabase' : 'cap',
      explanation:
        missing.length === 0
          ? 'Connexió amb Supabase configurada. És l’única integració obligatòria.'
          : `Sense aquestes variables l’aplicació no pot arrencar. Cal definir: ${missing.join(', ')}.`,
      missing,
      variables,
    });
  }

  // Google Calendar -------------------------------------------------------
  {
    const variables = [
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_REDIRECT_URI',
    ];
    const missing = missingFrom(source, variables);
    const configured = missing.length === 0;
    reports.push({
      key: 'googleCalendar',
      label: 'Google Calendar',
      status: configured ? 'CONFIGURED' : 'NOT_CONFIGURED',
      activeProvider: configured ? 'google' : 'local',
      explanation: configured
        ? 'Els comercials poden connectar el seu compte de Google i sincronitzar les visites en tots dos sentits.'
        : 'El calendari funciona amb el proveïdor local (les visites es guarden només al CRM). Per sincronitzar amb Google cal crear un client OAuth a Google Cloud amb l’API de Calendar activada i definir ' +
          `${missing.join(', ')}.`,
      missing,
      variables,
    });
  }

  // Google Calendar push notifications -----------------------------------
  {
    const variables = ['GOOGLE_CALENDAR_WEBHOOK_URL'];
    const missing = missingFrom(source, variables);
    const configured = missing.length === 0;
    reports.push({
      key: 'googleCalendarWebhook',
      label: 'Avisos de canvi de Google Calendar',
      status: configured ? 'CONFIGURED' : 'NOT_CONFIGURED',
      activeProvider: configured ? 'webhook' : 'sondeig',
      explanation: configured
        ? 'Google avisa immediatament de qualsevol canvi fet des del calendari.'
        : 'Sense GOOGLE_CALENDAR_WEBHOOK_URL els canvis fets a Google es detecten per sondeig, no a l’instant. Cal una URL HTTPS pública accessible des d’Internet.',
      missing,
      variables,
    });
  }

  // Transcription ---------------------------------------------------------
  {
    const variables = ['TRANSCRIPTION_PROVIDER', 'OPENAI_API_KEY', 'TRANSCRIPTION_MODEL'];
    const providerRaw = (source.TRANSCRIPTION_PROVIDER ?? '').trim().toLowerCase();
    const wantsOpenAI = providerRaw === 'openai' || (providerRaw === '' && present(source, 'OPENAI_API_KEY'));
    const missing = wantsOpenAI ? missingFrom(source, ['OPENAI_API_KEY']) : ['OPENAI_API_KEY'];
    const configured = wantsOpenAI && missing.length === 0;
    reports.push({
      key: 'transcription',
      label: 'Transcripció de notes de veu',
      status: configured ? 'CONFIGURED' : 'NOT_CONFIGURED',
      activeProvider: configured ? 'openai' : 'local',
      explanation: configured
        ? 'Els àudios es transcriuen automàticament amb OpenAI Whisper.'
        : 'La transcripció automàtica està desactivada: es pot enganxar la transcripció a mà i tota la resta del flux funciona igual. Per activar-la, defineix TRANSCRIPTION_PROVIDER=openai i OPENAI_API_KEY (opcionalment TRANSCRIPTION_MODEL, per defecte «whisper-1»).',
      missing,
      variables,
    });
  }

  // Interpretation --------------------------------------------------------
  {
    const variables = ['ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL'];
    const missing = missingFrom(source, ['ANTHROPIC_API_KEY']);
    const configured = missing.length === 0;
    reports.push({
      key: 'interpretation',
      label: 'Interpretació de les notes de veu',
      status: configured ? 'CONFIGURED' : 'NOT_CONFIGURED',
      activeProvider: configured ? 'anthropic' : 'local',
      explanation: configured
        ? `Les transcripcions es converteixen en propostes d’accions amb el model «${(source.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL).trim() || DEFAULT_ANTHROPIC_MODEL}». Cap acció s’aplica sense confirmació humana.`
        : `S’utilitza l’intèrpret local basat en regles: reconeix empresa, acció, resultat, producte, prioritat i data. Per activar el model, defineix ANTHROPIC_API_KEY (opcionalment ANTHROPIC_MODEL, per defecte «${DEFAULT_ANTHROPIC_MODEL}»).`,
      missing,
      variables,
    });
  }

  // Geocoding -------------------------------------------------------------
  {
    const variables = ['GEOCODING_PROVIDER', 'GOOGLE_MAPS_API_KEY'];
    const providerRaw = (source.GEOCODING_PROVIDER ?? '').trim().toLowerCase();
    const wantsGoogle = providerRaw === 'google' || (providerRaw === '' && present(source, 'GOOGLE_MAPS_API_KEY'));
    const missing = wantsGoogle ? missingFrom(source, ['GOOGLE_MAPS_API_KEY']) : ['GOOGLE_MAPS_API_KEY'];
    const configured = wantsGoogle && missing.length === 0;
    reports.push({
      key: 'geocoding',
      label: 'Geocodificació d’adreces',
      status: configured ? 'CONFIGURED' : 'NOT_CONFIGURED',
      activeProvider: configured ? 'google' : 'cap',
      explanation: configured
        ? 'Les adreces verificades es converteixen en coordenades per als avisos d’arribada.'
        : 'Les adreces queden marcades com a PENDENT DE GEOLOCALITZAR i mai s’inventen coordenades. Per activar-ho, defineix GEOCODING_PROVIDER=google i GOOGLE_MAPS_API_KEY amb l’API de Geocoding habilitada.',
      missing,
      variables,
    });
  }

  // Mobile push -----------------------------------------------------------
  {
    const variables = ['EXPO_PROJECT_ID', 'EXPO_PUBLIC_API_URL'];
    const missing = missingFrom(source, ['EXPO_PROJECT_ID']);
    const configured = missing.length === 0;
    reports.push({
      key: 'mobilePush',
      label: 'Notificacions push (Expo)',
      status: configured ? 'CONFIGURED' : 'NOT_CONFIGURED',
      activeProvider: configured ? 'expo' : 'cap',
      explanation: configured
        ? 'L’app mòbil pot registrar dispositius i rebre recordatoris de visita.'
        : 'Les notificacions push estan desactivades; els recordatoris només es veuen dins de l’app. Per activar-les, defineix EXPO_PROJECT_ID (i EXPO_PUBLIC_API_URL si l’API no és a NEXT_PUBLIC_APP_URL).',
      missing,
      variables,
    });
  }

  // Error tracking --------------------------------------------------------
  {
    const variables = ['SENTRY_DSN'];
    const missing = missingFrom(source, variables);
    const configured = missing.length === 0;
    reports.push({
      key: 'errorTracking',
      label: 'Registre d’errors (Sentry)',
      status: configured ? 'CONFIGURED' : 'NOT_CONFIGURED',
      activeProvider: configured ? 'sentry' : 'cap',
      explanation: configured
        ? 'Els errors no controlats s’envien a Sentry.'
        : 'Els errors només queden al registre del servidor. Per enviar-los a Sentry, defineix SENTRY_DSN.',
      missing,
      variables,
    });
  }

  return reports;
}

/** Convenience wrapper for a single integration. */
export function isIntegrationConfigured(
  key: IntegrationKey,
  source: EnvSource = readProcessEnv(),
): boolean {
  return integrationStatus(source).some((r) => r.key === key && r.status === 'CONFIGURED');
}
