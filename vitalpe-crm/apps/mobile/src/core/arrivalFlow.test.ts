/**
 * The arrival flow end to end, in pure code.
 *
 * This is the sequence the phone actually performs when the OS reports a region
 * crossing: cache → candidates → plan → (crossing) → decision → notification →
 * route. Each piece has its own tests; this one asserts they compose, which is
 * where a refactor breaks things that unit tests still pass.
 *
 * It deliberately runs with no device: everything under `src/core` is plain
 * TypeScript, which is what lets the whole decision path be verified before a
 * build exists.
 */
import { describe, expect, it } from 'vitest';
import { candidatesFromCache, planRegions, regionIdFor } from './regionPlan';
import { evaluateArrival, type MonitoredRegion } from './arrival';
import {
  buildAmbiguousArrivalNotification,
  buildArrivalNotification,
  notificationPayloadIsMinimal,
} from './notificationPayload';
import { isSafeInAppRoute, parseDeepLink } from './deepLinks';
import { DEFAULT_SETTINGS } from './cache';

const NOW = new Date('2026-07-25T09:00:00.000Z');
const CLIENT_A = '11111111-1111-4111-8111-111111111111';
const LOCATION_A = '22222222-2222-4222-8222-222222222222';
const CLIENT_B = '33333333-3333-4333-8333-333333333333';
const LOCATION_B = '44444444-4444-4444-8444-444444444444';

function cachedClient(id: string, locationId: string, lat: number, lng: number) {
  return {
    id,
    locationId,
    latitude: lat,
    longitude: lng,
    geofenceRadiusM: 120,
    geofenceEnabled: true,
    isAssigned: true,
    lastVisitedAt: null,
  };
}

describe('arribada: de la còpia local fins a la fitxa', () => {
  it('una visita d’avui es converteix en regió, avís i ruta a la fitxa correcta', () => {
    const candidates = candidatesFromCache({
      clients: [cachedClient(CLIENT_A, LOCATION_A, 41.36, 1.7)],
      visits: [{ clientId: CLIENT_A, startsAt: NOW.toISOString(), status: 'PLANIFICADA' }],
      tasks: [],
    });
    const plan = planRegions(candidates, {
      now: NOW,
      platform: 'ios',
      settings: DEFAULT_SETTINGS,
    });

    expect(plan.desired).toHaveLength(1);
    const region = plan.desired[0]!;
    expect(region.regionId).toBe(regionIdFor(CLIENT_A, LOCATION_A));
    expect(region.priority).toBe(1);

    const monitored: MonitoredRegion[] = [
      {
        regionId: region.regionId,
        clientId: region.clientId,
        locationId: region.locationId,
        latitude: region.latitude,
        longitude: region.longitude,
        radiusM: region.radiusM,
        clientName: 'BODEGA TEST',
        nearestVisitStartsAt: NOW.toISOString(),
      },
    ];

    const decision = evaluateArrival({
      regionId: region.regionId,
      eventType: 'ENTRADA',
      regions: monitored,
      position: { latitude: 41.36, longitude: 1.7 },
      now: NOW,
      settings: DEFAULT_SETTINGS,
    });
    expect(decision.action).toBe('NOTIFICAR');
    expect(decision.confidence).toBe('ALTA');
    if (decision.action !== 'NOTIFICAR') return;

    const notification = buildArrivalNotification({
      clientId: decision.region.clientId,
      locationId: decision.region.locationId,
      clientName: decision.region.clientName ?? '',
      confidence: decision.confidence ?? 'MITJANA',
      hideClientName: false,
    });
    expect(notification).not.toBeNull();
    expect(notificationPayloadIsMinimal(notification!.data)).toBe(true);

    // The route is what `_layout.tsx` will navigate to, so it has to survive
    // the same validation the layout applies.
    const route = notification!.data.route;
    expect(isSafeInAppRoute(route)).toBe(true);
    expect(parseDeepLink(`vitalpe://${route.slice(1)}`)?.route).toBe(route);
    expect(route).toContain(CLIENT_A);
  });

  it('amb el nom amagat, ni el títol ni el cos anomenen l’empresa', () => {
    const notification = buildArrivalNotification({
      clientId: CLIENT_A,
      locationId: LOCATION_A,
      clientName: 'BODEGA SECRETA',
      confidence: 'ALTA',
      hideClientName: true,
    })!;
    expect(notification.title).not.toContain('SECRETA');
    expect(notification.body).not.toContain('SECRETA');
    expect(notificationPayloadIsMinimal(notification.data)).toBe(true);
  });

  it('dues empreses al mateix punt obren el triador, no una fitxa qualsevol', () => {
    const regions: MonitoredRegion[] = [
      {
        regionId: regionIdFor(CLIENT_A, LOCATION_A),
        clientId: CLIENT_A, locationId: LOCATION_A,
        latitude: 41.36, longitude: 1.7, radiusM: 120, clientName: 'A',
      },
      {
        regionId: regionIdFor(CLIENT_B, LOCATION_B),
        clientId: CLIENT_B, locationId: LOCATION_B,
        latitude: 41.3601, longitude: 1.7001, radiusM: 120, clientName: 'B',
      },
    ];
    const decision = evaluateArrival({
      regionId: regions[0]!.regionId,
      eventType: 'ENTRADA',
      regions,
      position: { latitude: 41.36005, longitude: 1.70005 },
      now: NOW,
      settings: DEFAULT_SETTINGS,
    });
    expect(decision.action).toBe('PREGUNTAR');
    expect(decision.candidates.length).toBeGreaterThanOrEqual(2);

    const notification = buildAmbiguousArrivalNotification({
      candidates: decision.candidates,
      hideClientName: false,
    })!;
    expect(notification.data.clientId).toBeNull();
    expect(notificationPayloadIsMinimal(notification.data)).toBe(true);

    const target = parseDeepLink(`vitalpe://${notification.data.route.slice(1)}`);
    expect(target?.kind).toBe('ARRIBADA');
  });

  it('un client sense coordenades no arriba mai a ser una regió', () => {
    const candidates = candidatesFromCache({
      clients: [
        { ...cachedClient(CLIENT_A, LOCATION_A, 41.36, 1.7), latitude: null, longitude: null },
      ],
      visits: [],
      tasks: [],
    });
    const plan = planRegions(candidates, {
      now: NOW, platform: 'ios', settings: DEFAULT_SETTINGS,
    });
    expect(plan.desired).toHaveLength(0);
  });

  it('replanificar amb les mateixes dades no toca res al sistema operatiu', () => {
    const candidates = candidatesFromCache({
      clients: [cachedClient(CLIENT_A, LOCATION_A, 41.36, 1.7)],
      visits: [],
      tasks: [],
    });
    const options = { now: NOW, platform: 'ios' as const, settings: DEFAULT_SETTINGS };
    const first = planRegions(candidates, options);
    const current = first.desired.map((r) => ({
      regionId: r.regionId, latitude: r.latitude, longitude: r.longitude, radiusM: r.radiusM,
    }));
    const second = planRegions(candidates, options, current);

    expect(second.toRegister).toHaveLength(0);
    expect(second.toRemove).toHaveLength(0);
    expect(second.unchanged).toHaveLength(1);
  });

  it('una ruta que no és nostra no es navega mai', () => {
    for (const hostile of [
      'https://evil.example/clients/' + CLIENT_A,
      'javascript:alert(1)',
      '/administracio/usuaris',
      '../../etc/passwd',
    ]) {
      const target = parseDeepLink(hostile);
      expect(target === null || isSafeInAppRoute(target.route)).toBe(true);
      if (target !== null) expect(target.route.startsWith('/clients') || target.route.startsWith('/arribada')).toBe(true);
    }
    expect(isSafeInAppRoute('/administracio/usuaris')).toBe(false);
  });
});
