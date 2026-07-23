import { describe, expect, it } from 'vitest';
import { fakeClock, type FetchLike } from '../util/http';
import {
  GEOCODING_NOT_CONFIGURED_MESSAGE,
  GeocodingError,
  GoogleGeocodingProvider,
  NullGeocodingProvider,
  PENDING_GEOCODE,
  createGeocodingProvider,
} from './index';

const REQUEST = {
  address: 'Camí del Celler 12',
  postalCode: '08770',
  municipality: "Sant Sadurní d'Anoia",
  province: 'Barcelona',
};

function harness(
  respond: (attempt: number, url: string) => Response,
): { fetchImpl: FetchLike; urls: string[] } {
  const urls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    urls.push(url);
    return respond(urls.length, url);
  };
  return { fetchImpl, urls };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const okResult = (overrides: Record<string, unknown> = {}) => ({
  status: 'OK',
  results: [
    {
      formatted_address: "Camí del Celler, 12, 08770 Sant Sadurní d'Anoia, Barcelona",
      geometry: { location: { lat: 41.4267, lng: 1.7869 }, location_type: 'ROOFTOP' },
      ...overrides,
    },
  ],
});

describe('NullGeocodingProvider', () => {
  it('returns PENDENT DE GEOLOCALITZAR and never any coordinates', async () => {
    const result = await new NullGeocodingProvider().geocode(REQUEST);
    expect(result.status).toBe(PENDING_GEOCODE);
    expect(result).not.toHaveProperty('latitude');
    expect(result).not.toHaveProperty('longitude');
    expect(JSON.stringify(result)).not.toMatch(/\d+\.\d{3,}/);
    if (result.status === 'OK') throw new Error('unreachable');
    expect(result.reason).toBe('NOT_CONFIGURED');
    expect(result.message).toBe(GEOCODING_NOT_CONFIGURED_MESSAGE);
    expect(result.message).toContain('GOOGLE_MAPS_API_KEY');
  });

  it('never invents coordinates whatever it is asked', async () => {
    const provider = new NullGeocodingProvider();
    for (const address of ['', '   ', 'Plaça Catalunya, Barcelona', '41.3874, 2.1686']) {
      const result = await provider.geocode({ address });
      expect(result.status).toBe(PENDING_GEOCODE);
      expect(result).not.toHaveProperty('latitude');
    }
  });
});

describe('GoogleGeocodingProvider', () => {
  it('resolves a precise address', async () => {
    const { fetchImpl, urls } = harness(() => json(okResult()));
    const result = await new GoogleGeocodingProvider({
      apiKey: 'maps-key',
      fetch: fetchImpl,
      clock: fakeClock(),
    }).geocode(REQUEST);

    expect(result).toMatchObject({
      status: 'OK',
      latitude: 41.4267,
      longitude: 1.7869,
      accuracyMeters: 10,
      source: 'google',
      geocodedAt: '2026-07-23T09:00:00.000Z',
    });
    const url = new URL(urls[0] as string);
    expect(url.searchParams.get('address')).toContain('Camí del Celler 12');
    expect(url.searchParams.get('key')).toBe('maps-key');
    expect(url.searchParams.get('language')).toBe('ca');
  });

  it('returns PENDENT when there is no match', async () => {
    const { fetchImpl } = harness(() => json({ status: 'ZERO_RESULTS', results: [] }));
    const result = await new GoogleGeocodingProvider({
      apiKey: 'maps-key',
      fetch: fetchImpl,
      clock: fakeClock(),
    }).geocode(REQUEST);
    expect(result.status).toBe(PENDING_GEOCODE);
    expect(result).not.toHaveProperty('latitude');
    if (result.status === 'OK') throw new Error('unreachable');
    expect(result.reason).toBe('NO_MATCH');
  });

  it('refuses a result that is too coarse to build a geofence on', async () => {
    const { fetchImpl } = harness(() =>
      json({
        status: 'OK',
        results: [
          {
            formatted_address: 'Barcelona, Espanya',
            geometry: { location: { lat: 41.3874, lng: 2.1686 }, location_type: 'APPROXIMATE' },
          },
        ],
      }),
    );
    const result = await new GoogleGeocodingProvider({
      apiKey: 'maps-key',
      fetch: fetchImpl,
      clock: fakeClock(),
    }).geocode(REQUEST);
    expect(result.status).toBe(PENDING_GEOCODE);
    expect(result).not.toHaveProperty('latitude');
    if (result.status === 'OK') throw new Error('unreachable');
    expect(result.reason).toBe('AMBIGUOUS');
  });

  it('refuses a partial match', async () => {
    const { fetchImpl } = harness(() => json(okResult({ partial_match: true })));
    const result = await new GoogleGeocodingProvider({
      apiKey: 'maps-key',
      fetch: fetchImpl,
      clock: fakeClock(),
    }).geocode(REQUEST);
    expect(result.status).toBe(PENDING_GEOCODE);
  });

  it('degrades to PENDENT — not an exception — when the provider is down', async () => {
    const { fetchImpl } = harness(() => json({ error: { message: 'boom' } }, 503));
    const result = await new GoogleGeocodingProvider({
      apiKey: 'maps-key',
      fetch: fetchImpl,
      clock: fakeClock(),
      retry: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 2 },
    }).geocode(REQUEST);
    expect(result.status).toBe(PENDING_GEOCODE);
    if (result.status === 'OK') throw new Error('unreachable');
    expect(result.reason).toBe('PROVIDER_ERROR');
  });

  it('rejects an empty address without calling out', async () => {
    const { fetchImpl, urls } = harness(() => json(okResult()));
    const result = await new GoogleGeocodingProvider({ apiKey: 'k', fetch: fetchImpl }).geocode({
      address: '   ',
    });
    expect(result.status).toBe(PENDING_GEOCODE);
    expect(urls).toHaveLength(0);
  });

  it('refuses to be constructed without a key', () => {
    expect(() => new GoogleGeocodingProvider({ apiKey: '' })).toThrow(GeocodingError);
  });

  it('never leaks the key in an error message', async () => {
    const { fetchImpl } = harness(() => json({ error_message: 'The provided API key maps-key-123456 is invalid' }, 403));
    const result = await new GoogleGeocodingProvider({
      apiKey: 'maps-key-123456',
      fetch: fetchImpl,
      clock: fakeClock(),
    }).geocode(REQUEST);
    if (result.status === 'OK') throw new Error('unreachable');
    expect(result.message).not.toContain('maps-key-123456');
  });
});

describe('createGeocodingProvider', () => {
  it('defaults to the null provider', () => {
    expect(createGeocodingProvider({}).name).toBe('none');
    expect(createGeocodingProvider({ GEOCODING_PROVIDER: 'google' }).name).toBe('none');
    expect(createGeocodingProvider({ GEOCODING_PROVIDER: 'none', GOOGLE_MAPS_API_KEY: 'k' }).name).toBe(
      'none',
    );
  });

  it('uses Google when fully configured', () => {
    expect(
      createGeocodingProvider({ GEOCODING_PROVIDER: 'google', GOOGLE_MAPS_API_KEY: 'k' }).name,
    ).toBe('google');
  });
});
