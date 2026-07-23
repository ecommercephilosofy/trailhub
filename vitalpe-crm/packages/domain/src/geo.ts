/**
 * Geodesy — the TypeScript twin of `app.distance_meters` in
 * `supabase/migrations/20260723094000_domain.sql`.
 *
 * Haversine on a sphere of radius 6 371 000 m. Deliberately identical, term by
 * term, to the SQL expression so `app.nearby_clients` and the mobile client
 * never disagree about who is inside a radius.
 */

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** Mean Earth radius used by `app.distance_meters`. */
export const EARTH_RADIUS_M = 6371000;

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * `app.distance_meters(lat1, lon1, lat2, lon2) -> double precision`
 *
 *   2 * 6371000 * asin(sqrt(
 *     sin((lat2-lat1)/2)^2 + cos(lat1) * cos(lat2) * sin((lon2-lon1)/2)^2
 *   ))
 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = Math.sin(radians(b.latitude - a.latitude) / 2);
  const dLon = Math.sin(radians(b.longitude - a.longitude) / 2);
  return (
    2 *
    EARTH_RADIUS_M *
    Math.asin(
      Math.sqrt(
        Math.pow(dLat, 2) +
          Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.pow(dLon, 2),
      ),
    )
  );
}

/** Convenience wrapper: is `point` within `radiusMeters` of `centre`? */
export function isWithinRadius(centre: LatLng, point: LatLng, radiusMeters: number): boolean {
  return haversineMeters(centre, point) <= radiusMeters;
}

/**
 * Bounding box used by `app.nearby_clients` before the exact test, transcribed
 * so a client-side prefilter selects exactly the same candidate set.
 */
export function boundingBox(
  centre: LatLng,
  radiusMeters: number,
): { minLat: number; maxLat: number; minLon: number; maxLon: number } {
  const dLat = radiusMeters / 111320.0;
  const dLon = radiusMeters / (111320.0 * Math.max(Math.cos(radians(centre.latitude)), 0.01));
  return {
    minLat: centre.latitude - dLat,
    maxLat: centre.latitude + dLat,
    minLon: centre.longitude - dLon,
    maxLon: centre.longitude + dLon,
  };
}
