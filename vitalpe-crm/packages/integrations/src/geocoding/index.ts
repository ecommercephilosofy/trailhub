/**
 * Address → coordinates.
 *
 * The one rule that matters: **never invent coordinates.** A wrong latitude is
 * worse than no latitude — it puts a geofence on someone else's building and
 * fires an arrival notification for the wrong client. When there is no
 * provider configured, or the provider cannot resolve the address, the answer
 * is `PENDENT DE GEOLOCALITZAR` (the same value the `v_client_geo_status` view
 * reports) and no numbers at all.
 */
import {
  DEFAULT_RETRY,
  parseRetryAfter,
  readBodySafely,
  requestWithRetry,
  systemClock,
  type Clock,
  type FetchLike,
  type RetryDecision,
  type RetryPolicy,
} from '../util/http';
import { createSecretScrubber, redact } from '../util/redact';

export const PENDING_GEOCODE = 'PENDENT DE GEOLOCALITZAR' as const;

export interface GeocodeRequest {
  /** Free-form address as typed by the user. */
  readonly address: string;
  readonly postalCode?: string;
  readonly municipality?: string;
  readonly province?: string;
  /** ISO-3166-1 alpha-2. Biases the search; defaults to `ES`. */
  readonly country?: string;
}

export type GeocodeResult =
  | {
      readonly status: 'OK';
      readonly latitude: number;
      readonly longitude: number;
      readonly formattedAddress: string;
      readonly accuracyMeters?: number;
      readonly source: string;
      readonly geocodedAt: string;
    }
  | {
      readonly status: typeof PENDING_GEOCODE;
      readonly reason: GeocodePendingReason;
      /** Catalan explanation for the UI. */
      readonly message: string;
      readonly source: string;
    };

export type GeocodePendingReason =
  | 'NOT_CONFIGURED'
  | 'NO_MATCH'
  | 'AMBIGUOUS'
  | 'EMPTY_ADDRESS'
  | 'PROVIDER_ERROR';

export interface GeocodingProvider {
  readonly name: string;
  geocode(request: GeocodeRequest): Promise<GeocodeResult>;
}

export class GeocodingError extends Error {
  override readonly name: string = 'GeocodingError';
}

function composeAddress(request: GeocodeRequest): string {
  return [request.address, request.postalCode, request.municipality, request.province]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part && part.length > 0))
    .join(', ');
}

// ---------------------------------------------------------------------------
// Null provider — the default
// ---------------------------------------------------------------------------

export const GEOCODING_NOT_CONFIGURED_MESSAGE =
  'La geocodificació no està configurada, així que aquesta adreça queda com a PENDENT DE GEOLOCALITZAR. ' +
  'Es pot fixar la ubicació a mà des de la fitxa del client. Per activar-la, defineix GEOCODING_PROVIDER=google ' +
  "i GOOGLE_MAPS_API_KEY amb l'API de Geocoding habilitada.";

export class NullGeocodingProvider implements GeocodingProvider {
  readonly name = 'none';

  async geocode(request: GeocodeRequest): Promise<GeocodeResult> {
    return {
      status: PENDING_GEOCODE,
      reason: composeAddress(request).length === 0 ? 'EMPTY_ADDRESS' : 'NOT_CONFIGURED',
      message: GEOCODING_NOT_CONFIGURED_MESSAGE,
      source: this.name,
    };
  }
}

// ---------------------------------------------------------------------------
// Google Geocoding
// ---------------------------------------------------------------------------

export const GOOGLE_GEOCODING_ENDPOINT = 'https://maps.googleapis.com/maps/api/geocode/json';

/** Google's `location_type` mapped to a rough accuracy radius, in metres. */
const ACCURACY_BY_LOCATION_TYPE: Record<string, number> = {
  ROOFTOP: 10,
  RANGE_INTERPOLATED: 50,
  GEOMETRIC_CENTER: 150,
  APPROXIMATE: 500,
};

export interface GoogleGeocodingOptions {
  readonly apiKey: string;
  readonly endpoint?: string;
  readonly fetch?: FetchLike;
  readonly clock?: Clock;
  readonly retry?: RetryPolicy;
  readonly region?: string;
  readonly language?: string;
  /**
   * Reject results coarser than this. A town-centre coordinate is not an
   * address, and a geofence built on one fires in the wrong place.
   */
  readonly maxAccuracyMeters?: number;
}

interface GoogleGeocodeResponse {
  status?: string;
  error_message?: string;
  results?: Array<{
    formatted_address?: string;
    geometry?: {
      location?: { lat?: number; lng?: number };
      location_type?: string;
    };
    partial_match?: boolean;
  }>;
}

export class GoogleGeocodingProvider implements GeocodingProvider {
  readonly name = 'google';

  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly fetchImpl: FetchLike;
  private readonly clock: Clock;
  private readonly retry: RetryPolicy;
  private readonly region: string;
  private readonly language: string;
  private readonly maxAccuracyMeters: number;
  /** Removes this provider's own key from anything it reports. */
  private readonly scrub: (text: string) => string;

  constructor(options: GoogleGeocodingOptions) {
    if (!options.apiKey || options.apiKey.trim().length === 0) {
      throw new GeocodingError(
        'Falta GOOGLE_MAPS_API_KEY: no es pot crear el proveïdor de geocodificació de Google.',
      );
    }
    this.apiKey = options.apiKey;
    this.endpoint = options.endpoint ?? GOOGLE_GEOCODING_ENDPOINT;
    this.fetchImpl = options.fetch ?? (globalThis.fetch as FetchLike);
    this.clock = options.clock ?? systemClock;
    this.retry = options.retry ?? DEFAULT_RETRY;
    this.region = options.region ?? 'es';
    this.language = options.language ?? 'ca';
    this.maxAccuracyMeters = options.maxAccuracyMeters ?? 200;
    this.scrub = createSecretScrubber(this.apiKey);
  }

  async geocode(request: GeocodeRequest): Promise<GeocodeResult> {
    const address = composeAddress(request);
    if (address.length === 0) {
      return {
        status: PENDING_GEOCODE,
        reason: 'EMPTY_ADDRESS',
        message: 'No hi ha cap adreça per geolocalitzar.',
        source: this.name,
      };
    }

    const query = new URLSearchParams({
      address,
      key: this.apiKey,
      region: request.country?.toLowerCase() ?? this.region,
      language: this.language,
    });

    const send = (): Promise<Response> =>
      this.fetchImpl(`${this.endpoint}?${query.toString()}`, { method: 'GET' });

    const classify = async (response: Response): Promise<RetryDecision> => {
      if (response.ok) return { kind: 'return' };
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = parseRetryAfter(response);
        return retryAfter === undefined
          ? { kind: 'retry' }
          : { kind: 'retry', retryAfterSeconds: retryAfter };
      }
      const body = await readBodySafely(response);
      return {
        kind: 'fail',
        error: new GeocodingError(
          `El servei de geocodificació ha retornat un error ${response.status}: ${this.scrub(
            String(redact(body)),
          )}`,
        ),
      };
    };

    let payload: GoogleGeocodeResponse;
    try {
      const response = await requestWithRetry(
        { fetch: this.fetchImpl, clock: this.clock, retry: this.retry },
        send,
        classify,
      );
      payload = JSON.parse(await readBodySafely(response, 500_000)) as GoogleGeocodeResponse;
    } catch (error) {
      // A provider outage must not block saving the client: the address stays
      // pending and a later run can retry it.
      return {
        status: PENDING_GEOCODE,
        reason: 'PROVIDER_ERROR',
        message: `No s'ha pogut geolocalitzar l'adreça ara mateix: ${this.scrub(
          String(redact(error instanceof Error ? error.message : String(error))),
        )}. Es tornarà a provar més endavant.`,
        source: this.name,
      };
    }

    if (payload.status === 'ZERO_RESULTS' || (payload.results ?? []).length === 0) {
      return {
        status: PENDING_GEOCODE,
        reason: 'NO_MATCH',
        message: `No s'ha trobat cap ubicació per a «${address}». Cal revisar-la o fixar-la al mapa manualment.`,
        source: this.name,
      };
    }
    if (payload.status !== 'OK') {
      return {
        status: PENDING_GEOCODE,
        reason: 'PROVIDER_ERROR',
        message: `El servei de geocodificació ha respost «${payload.status ?? 'desconegut'}».`,
        source: this.name,
      };
    }

    const best = payload.results?.[0];
    const lat = best?.geometry?.location?.lat;
    const lng = best?.geometry?.location?.lng;
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return {
        status: PENDING_GEOCODE,
        reason: 'NO_MATCH',
        message: 'La resposta del servei no inclou coordenades utilitzables.',
        source: this.name,
      };
    }

    const accuracy = ACCURACY_BY_LOCATION_TYPE[best?.geometry?.location_type ?? 'APPROXIMATE'] ?? 500;
    if (accuracy > this.maxAccuracyMeters || best?.partial_match === true) {
      return {
        status: PENDING_GEOCODE,
        reason: 'AMBIGUOUS',
        message:
          `La ubicació trobada per a «${address}» és massa imprecisa (±${accuracy} m) per fer-la servir. ` +
          'Cal confirmar-la manualment.',
        source: this.name,
      };
    }

    return {
      status: 'OK',
      latitude: lat,
      longitude: lng,
      formattedAddress: best?.formatted_address ?? address,
      accuracyMeters: accuracy,
      source: this.name,
      geocodedAt: this.clock.now().toISOString(),
    };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface GeocodingEnv {
  readonly GEOCODING_PROVIDER?: string;
  readonly GOOGLE_MAPS_API_KEY?: string;
}

/** Never throws: an unconfigured geocoder is a supported state, not an error. */
export function createGeocodingProvider(
  env: GeocodingEnv,
  deps: { fetch?: FetchLike; clock?: Clock; retry?: RetryPolicy } = {},
): GeocodingProvider {
  const provider = (env.GEOCODING_PROVIDER ?? '').trim().toLowerCase();
  const apiKey = env.GOOGLE_MAPS_API_KEY?.trim();
  const wantsGoogle = provider === 'google' || (provider === '' && Boolean(apiKey));
  if (!wantsGoogle || !apiKey) return new NullGeocodingProvider();
  return new GoogleGeocodingProvider({ apiKey, ...deps });
}
