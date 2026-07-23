import { describe, expect, it } from 'vitest';
import {
  APP_SCHEME,
  DEFAULT_APP_HOST,
  isSafeInAppRoute,
  isUuid,
  parseDeepLink,
  routeForArrivalChooser,
  routeForClient,
  routeForVisit,
  webUrlForClient,
} from './deepLinks.js';

const CLIENT = '2f1c6b7a-9d3e-4a51-8b0c-1d2e3f405162';
const VISIT = 'aa11bb22-cc33-dd44-ee55-ff6677889900';
const LOCATION = '0badc0de-1111-2222-3333-444455556666';

describe('isUuid', () => {
  it('accepts the 8-4-4-4-12 shape in either case', () => {
    expect(isUuid(CLIENT)).toBe(true);
    expect(isUuid(CLIENT.toUpperCase())).toBe(true);
  });

  it('rejects anything else, including path traversal and numeric ids', () => {
    for (const bad of ['', '42', '../../etc', `${CLIENT}/extra`, `${CLIENT}x`, null, undefined]) {
      expect(isUuid(bad as string)).toBe(false);
    }
  });
});

describe('route builders', () => {
  it('lower-cases ids so the same client always produces the same route', () => {
    expect(routeForClient(CLIENT.toUpperCase())).toBe(`/clients/${CLIENT}`);
    expect(routeForVisit(CLIENT, VISIT.toUpperCase())).toBe(`/clients/${CLIENT}/visits/${VISIT}`);
  });

  it('refuses to build a route from an id it cannot vouch for', () => {
    expect(routeForClient('not-a-uuid')).toBeNull();
    expect(routeForVisit(CLIENT, 'nope')).toBeNull();
    expect(routeForArrivalChooser([])).toBeNull();
  });

  it('encodes chooser candidates as id pairs only', () => {
    expect(routeForArrivalChooser([{ clientId: CLIENT, locationId: LOCATION }])).toBe(
      `/arribada?candidats=${CLIENT}.${LOCATION}`,
    );
  });

  it('builds the shareable https URL from the same route', () => {
    expect(webUrlForClient(CLIENT)).toBe(`https://${DEFAULT_APP_HOST}/clients/${CLIENT}`);
  });
});

describe('parseDeepLink — the custom scheme', () => {
  it('parses a client card, with the id in the authority position', () => {
    expect(parseDeepLink(`${APP_SCHEME}://clients/${CLIENT}`)).toEqual({
      kind: 'CLIENT',
      clientId: CLIENT,
      route: `/clients/${CLIENT}`,
    });
  });

  it('parses the triple-slash and single-slash spellings the OS may hand us', () => {
    for (const url of [
      `${APP_SCHEME}:///clients/${CLIENT}`,
      `${APP_SCHEME}:/clients/${CLIENT}`,
      `${APP_SCHEME}://clients/${CLIENT}/`,
    ]) {
      expect(parseDeepLink(url)).toMatchObject({ kind: 'CLIENT', clientId: CLIENT });
    }
  });

  it('parses a visit', () => {
    expect(parseDeepLink(`${APP_SCHEME}://clients/${CLIENT}/visits/${VISIT}`)).toEqual({
      kind: 'VISITA',
      clientId: CLIENT,
      visitId: VISIT,
      route: `/clients/${CLIENT}/visits/${VISIT}`,
    });
  });

  it('parses the arrival chooser and keeps candidate order', () => {
    const url = `${APP_SCHEME}://arribada?candidats=${CLIENT}.${LOCATION},${VISIT}.${LOCATION}`;
    expect(parseDeepLink(url)).toEqual({
      kind: 'ARRIBADA',
      candidates: [
        { clientId: CLIENT, locationId: LOCATION },
        { clientId: VISIT, locationId: LOCATION },
      ],
      route: `/arribada?candidats=${CLIENT}.${LOCATION},${VISIT}.${LOCATION}`,
    });
  });

  it('ignores query strings and fragments on a client link', () => {
    expect(parseDeepLink(`${APP_SCHEME}://clients/${CLIENT}?from=push#top`)).toMatchObject({
      kind: 'CLIENT',
      clientId: CLIENT,
    });
  });
});

describe('parseDeepLink — https universal links', () => {
  it('accepts the configured host', () => {
    expect(parseDeepLink(`https://${DEFAULT_APP_HOST}/clients/${CLIENT}`)).toMatchObject({
      kind: 'CLIENT',
      clientId: CLIENT,
    });
  });

  it('accepts a host passed in explicitly', () => {
    expect(
      parseDeepLink(`https://crm.example.org/clients/${CLIENT}`, {
        allowedHosts: ['crm.example.org'],
      }),
    ).toMatchObject({ kind: 'CLIENT' });
  });

  it('rejects a look-alike host, a userinfo trick and plain http', () => {
    expect(parseDeepLink(`https://crm.vitalpe.cat.evil.example/clients/${CLIENT}`)).toBeNull();
    expect(parseDeepLink(`https://evil.example@attacker.test/clients/${CLIENT}`)).toBeNull();
    expect(parseDeepLink(`http://${DEFAULT_APP_HOST}/clients/${CLIENT}`)).toBeNull();
  });

  it('ignores the port when matching the host', () => {
    expect(parseDeepLink(`https://${DEFAULT_APP_HOST}:443/clients/${CLIENT}`)).toMatchObject({
      kind: 'CLIENT',
    });
  });
});

describe('parseDeepLink — refusals', () => {
  it('returns null instead of guessing', () => {
    for (const url of [
      '',
      'not a url',
      'javascript:alert(1)',
      'vitalpe://clients',
      'vitalpe://clients/123',
      `vitalpe://clients/${CLIENT}/visits`,
      `vitalpe://clients/${CLIENT}/visits/${VISIT}/extra`,
      `vitalpe://tasques/${CLIENT}`,
      'vitalpe://arribada',
      'vitalpe://arribada?candidats=',
      `vitalpe://arribada?candidats=${CLIENT}`,
      `vitalpe://arribada?candidats=${CLIENT}.nope`,
      `otherapp://clients/${CLIENT}`,
      null,
      undefined,
    ]) {
      expect(parseDeepLink(url as string)).toBeNull();
    }
  });
});

describe('isSafeInAppRoute', () => {
  it('accepts exactly the routes the builders produce', () => {
    expect(isSafeInAppRoute(`/clients/${CLIENT}`)).toBe(true);
    expect(isSafeInAppRoute(`/clients/${CLIENT}/visits/${VISIT}`)).toBe(true);
    expect(isSafeInAppRoute(`/arribada?candidats=${CLIENT}.${LOCATION}`)).toBe(true);
  });

  it('rejects anything a hostile payload could put there', () => {
    for (const route of ['', 'clients/x', '/ajustos', '/clients/../ajustos', '//evil.test', null]) {
      expect(isSafeInAppRoute(route as string)).toBe(false);
    }
  });
});
