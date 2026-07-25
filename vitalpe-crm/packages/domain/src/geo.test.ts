import { describe, expect, it } from 'vitest';
import { boundingBox, EARTH_RADIUS_M, haversineMeters, isWithinRadius } from './geo';

const VILAFRANCA = { latitude: 41.3451, longitude: 1.6989 };
const BARCELONA = { latitude: 41.3851, longitude: 2.1734 };

describe('haversineMeters', () => {
  it('agrees with app.distance_meters (verified against PostgreSQL)', () => {
    // select app.distance_meters(41.3451, 1.6989, 41.3851, 2.1734)
    //  -> 39847.559122439336   (PGlite, PostgreSQL 17)
    expect(haversineMeters(VILAFRANCA, BARCELONA)).toBeCloseTo(39847.559122439336, 6);
  });

  it('uses the same Earth radius as the SQL', () => {
    expect(EARTH_RADIUS_M).toBe(6371000);
  });

  it('is zero for the same point', () => {
    expect(haversineMeters(BARCELONA, BARCELONA)).toBe(0);
  });

  it('is symmetric', () => {
    expect(haversineMeters(VILAFRANCA, BARCELONA)).toBeCloseTo(
      haversineMeters(BARCELONA, VILAFRANCA),
      9,
    );
  });

  it('gives one degree of longitude at the equator as ~111.19 km', () => {
    expect(haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 })).toBeCloseTo(
      111194.9,
      0,
    );
  });

  it('handles antipodal-ish long distances without NaN', () => {
    const d = haversineMeters(
      { latitude: -33.86, longitude: 151.2 },
      { latitude: 51.5, longitude: -0.12 },
    );
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeGreaterThan(16_000_000);
  });
});

describe('isWithinRadius', () => {
  it('is inclusive at the boundary', () => {
    const d = haversineMeters(VILAFRANCA, BARCELONA);
    expect(isWithinRadius(VILAFRANCA, BARCELONA, d)).toBe(true);
    expect(isWithinRadius(VILAFRANCA, BARCELONA, d - 1)).toBe(false);
  });
});

describe('boundingBox', () => {
  it('reproduces the prefilter used by app.nearby_clients', () => {
    const box = boundingBox(VILAFRANCA, 25000);
    expect(box.maxLat - VILAFRANCA.latitude).toBeCloseTo(25000 / 111320, 9);
    expect(box.maxLon - VILAFRANCA.longitude).toBeGreaterThan(25000 / 111320);
  });

  it('clamps the cosine near the poles, as the SQL greatest(cos, 0.01) does', () => {
    const box = boundingBox({ latitude: 89.9, longitude: 0 }, 1000);
    expect(Number.isFinite(box.maxLon)).toBe(true);
    expect(box.maxLon).toBeLessThanOrEqual(1000 / (111320 * 0.01));
  });

  it('contains every point actually within the radius', () => {
    const box = boundingBox(VILAFRANCA, 50000);
    expect(BARCELONA.latitude).toBeGreaterThanOrEqual(box.minLat);
    expect(BARCELONA.latitude).toBeLessThanOrEqual(box.maxLat);
    expect(BARCELONA.longitude).toBeGreaterThanOrEqual(box.minLon);
    expect(BARCELONA.longitude).toBeLessThanOrEqual(box.maxLon);
  });
});
