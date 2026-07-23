'use server';

import { revalidatePath } from 'next/cache';
import { query, requireSession } from '@/lib/auth';
import { friendlyError } from '@/lib/db';

/**
 * Location server actions.
 *
 * Coordinates are NEVER invented. They are either entered by a person (which
 * sets `verified_by_user` and records `geocode_source = 'MANUAL'`) or they stay
 * null and the location shows PENDENT DE GEOLOCALITZAR. The database enforces
 * the pair with `client_locations_coords_pair`.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const LOCATION_TYPES = ['SEU', 'MAGATZEM', 'VISITA', 'ALTRES'];

interface LocationInput {
  name: string;
  locationType: string;
  street: string;
  postalCode: string;
  municipality: string;
  comarca: string;
  province: string;
  notes: string;
  isPrimary: boolean;
  geofenceEnabled: boolean;
  geofenceRadius: number;
}

function read(formData: FormData): LocationInput {
  const text = (key: string): string => String(formData.get(key) ?? '').trim();
  const radius = Number.parseInt(text('geofenceRadius'), 10);
  const type = text('locationType');
  return {
    name: text('name'),
    locationType: LOCATION_TYPES.includes(type) ? type : 'SEU',
    street: text('street'),
    postalCode: text('postalCode'),
    municipality: text('municipality'),
    comarca: text('comarca'),
    province: text('province'),
    notes: text('notes'),
    isPrimary: formData.get('isPrimary') === 'on' || formData.get('isPrimary') === '1',
    geofenceEnabled: formData.get('geofenceEnabled') === 'on' || formData.get('geofenceEnabled') === '1',
    geofenceRadius: Number.isFinite(radius) ? Math.min(2000, Math.max(50, radius)) : 120,
  };
}

function formatted(input: LocationInput): string | null {
  const text = [input.street, input.postalCode, input.municipality, input.province]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ');
  return text || null;
}

export async function createLocation(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const clientId = String(formData.get('clientId') ?? '');
  const input = read(formData);
  if (!input.street && !input.municipality) {
    return { ok: false, error: 'Indica com a mínim el carrer o el municipi.' };
  }

  try {
    await query(session, async (q) => {
      if (input.isPrimary) {
        await q.run(
          `update public.client_locations set is_primary = false
            where client_id = $1::uuid and is_primary and deleted_at is null`,
          [clientId],
        );
      }
      await q.run(
        `insert into public.client_locations
           (workspace_id, client_id, name, location_type, street, postal_code, municipality,
            comarca, province, formatted_address, is_primary, geofence_enabled,
            geofence_radius_m, notes)
         values ($1::uuid, $2::uuid, nullif($3,''), $4::app.location_type, nullif($5,''),
                 nullif($6,''), nullif($7,''), nullif($8,''), nullif($9,''), $10, $11, $12, $13,
                 nullif($14,''))`,
        [
          session.workspaceId, clientId, input.name, input.locationType, input.street,
          input.postalCode, input.municipality, input.comarca, input.province, formatted(input),
          input.isPrimary, input.geofenceEnabled, input.geofenceRadius, input.notes,
        ],
      );
    });
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
  revalidatePath(`/clients/${clientId}`);
  revalidatePath('/clients');
  return { ok: true };
}

export async function updateLocation(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const clientId = String(formData.get('clientId') ?? '');
  const locationId = String(formData.get('locationId') ?? '');
  const input = read(formData);

  try {
    await query(session, async (q) => {
      if (input.isPrimary) {
        await q.run(
          `update public.client_locations set is_primary = false
            where client_id = $1::uuid and id <> $2::uuid and is_primary and deleted_at is null`,
          [clientId, locationId],
        );
      }
      await q.run(
        `update public.client_locations
            set name = nullif($3,''), location_type = $4::app.location_type, street = nullif($5,''),
                postal_code = nullif($6,''), municipality = nullif($7,''), comarca = nullif($8,''),
                province = nullif($9,''), formatted_address = $10, is_primary = $11,
                geofence_enabled = $12, geofence_radius_m = $13, notes = nullif($14,'')
          where id = $2::uuid and client_id = $1::uuid and deleted_at is null`,
        [
          clientId, locationId, input.name, input.locationType, input.street, input.postalCode,
          input.municipality, input.comarca, input.province, formatted(input), input.isPrimary,
          input.geofenceEnabled, input.geofenceRadius, input.notes,
        ],
      );
    });
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
  revalidatePath(`/clients/${clientId}`);
  revalidatePath('/clients');
  return { ok: true };
}

/**
 * "Posar el pin": a person types the coordinates. Both or neither — a lone
 * latitude is rejected before the database has to.
 */
export async function setCoordinates(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const clientId = String(formData.get('clientId') ?? '');
  const locationId = String(formData.get('locationId') ?? '');
  const rawLat = String(formData.get('latitude') ?? '').trim().replace(',', '.');
  const rawLon = String(formData.get('longitude') ?? '').trim().replace(',', '.');

  if (!rawLat && !rawLon) {
    // Clearing the pin is legitimate: it returns to PENDENT DE GEOLOCALITZAR.
    try {
      await query(session, async (q) => {
        await q.run(
          `update public.client_locations
              set latitude = null, longitude = null, geocode_source = null, geocoded_at = null,
                  verified_by_user = false
            where id = $2::uuid and client_id = $1::uuid and deleted_at is null`,
          [clientId, locationId],
        );
      });
    } catch (error) {
      return { ok: false, error: friendlyError(error) };
    }
    revalidatePath(`/clients/${clientId}`);
    return { ok: true };
  }

  const lat = Number(rawLat);
  const lon = Number(rawLon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { ok: false, error: 'Latitud i longitud han de ser dos números.' };
  }
  if (lat < -90 || lat > 90) return { ok: false, error: 'La latitud ha d’estar entre -90 i 90.' };
  if (lon < -180 || lon > 180) return { ok: false, error: 'La longitud ha d’estar entre -180 i 180.' };

  try {
    await query(session, async (q) => {
      await q.run(
        `update public.client_locations
            set latitude = $3, longitude = $4, geocode_source = 'MANUAL',
                geocoded_at = now(), verified_by_user = true
          where id = $2::uuid and client_id = $1::uuid and deleted_at is null`,
        [clientId, locationId, lat, lon],
      );
    });
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
  revalidatePath(`/clients/${clientId}`);
  revalidatePath('/clients');
  return { ok: true };
}

export async function removeLocation(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const clientId = String(formData.get('clientId') ?? '');
  const locationId = String(formData.get('locationId') ?? '');
  try {
    await query(session, async (q) => {
      await q.run(
        `update public.client_locations set deleted_at = now(), is_primary = false
          where id = $2::uuid and client_id = $1::uuid and deleted_at is null`,
        [clientId, locationId],
      );
    });
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
  revalidatePath(`/clients/${clientId}`);
  revalidatePath('/clients');
  return { ok: true };
}
