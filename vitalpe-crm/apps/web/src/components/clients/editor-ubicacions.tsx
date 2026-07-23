'use client';

import { useState } from 'react';
import {
  createLocation,
  removeLocation,
  setCoordinates,
  updateLocation,
} from '@/lib/actions/locations';
import { AccioForm, Camp, Panell } from './accio-form';

export interface UbicacioRow {
  id: string;
  name: string | null;
  location_type: string;
  street: string | null;
  postal_code: string | null;
  municipality: string | null;
  comarca: string | null;
  province: string | null;
  formatted_address: string | null;
  latitude: number | null;
  longitude: number | null;
  geocode_source: string | null;
  verified_by_user: boolean;
  is_primary: boolean;
  geofence_enabled: boolean;
  geofence_radius_m: number;
  notes: string | null;
}

const TYPES = ['SEU', 'MAGATZEM', 'VISITA', 'ALTRES'];

/**
 * UBICACIONS.
 *
 * Coordinates are never invented: either a person places the pin — which sets
 * "verificada per una persona" — or the location keeps showing PENDENT DE
 * GEOLOCALITZAR. There is no automatic guess behind this screen.
 */
export function EditorUbicacions({
  clientId,
  locations,
  canEdit,
}: {
  clientId: string;
  locations: UbicacioRow[];
  canEdit: boolean;
}): React.ReactElement {
  const [editing, setEditing] = useState<UbicacioRow | 'nova' | null>(null);
  const [pinning, setPinning] = useState<UbicacioRow | null>(null);

  return (
    <section className="grid gap-3">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="etiqueta m-0">UBICACIONS ({locations.length})</h2>
        {canEdit && (
          <button type="button" className="boto boto-principal" onClick={() => setEditing('nova')}>
            AFEGIR UBICACIÓ
          </button>
        )}
      </header>

      {locations.length === 0 ? (
        <p className="targeta p-4 m-0 text-[13px]">
          <span className="estat estat-neutre">PENDENT DE GEOLOCALITZAR</span>{' '}
          Aquesta empresa no té cap ubicació registrada.
        </p>
      ) : (
        <ul className="list-none p-0 m-0 grid gap-2">
          {locations.map((location) => (
            <li key={location.id} className="targeta p-3 grid gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{location.name ?? location.location_type}</span>
                <span className="estat estat-neutre">{location.location_type}</span>
                {location.is_primary && <span className="estat estat-marca">PRINCIPAL</span>}
                {location.latitude === null ? (
                  <span className="estat estat-avis">PENDENT DE GEOLOCALITZAR</span>
                ) : (
                  <span className="estat estat-ok">GEOLOCALITZADA</span>
                )}
                {location.verified_by_user && (
                  <span className="estat estat-ok">VERIFICADA PER UNA PERSONA</span>
                )}
              </div>

              <p className="m-0 text-[13px] text-[var(--color-ink-soft)]">
                {location.formatted_address ??
                  [location.street, location.postal_code, location.municipality, location.province]
                    .filter(Boolean)
                    .join(', ') ??
                  'Sense adreça'}
              </p>

              <dl className="grid gap-x-5 gap-y-1 m-0 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))] text-[12px]">
                <div>
                  <dt className="etiqueta">COORDENADES</dt>
                  <dd className="m-0 tabular-nums">
                    {location.latitude !== null && location.longitude !== null
                      ? `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`
                      : 'NO DETERMINADES'}
                  </dd>
                </div>
                <div>
                  <dt className="etiqueta">ORIGEN</dt>
                  <dd className="m-0">{location.geocode_source ?? '—'}</dd>
                </div>
                <div>
                  <dt className="etiqueta">GEOTANCA</dt>
                  <dd className="m-0">
                    {location.geofence_enabled
                      ? `ACTIVADA · ${location.geofence_radius_m} m`
                      : 'DESACTIVADA'}
                  </dd>
                </div>
              </dl>

              <div className="flex flex-wrap gap-2">
                {location.latitude !== null && location.longitude !== null && (
                  <a
                    className="boto"
                    href={`https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    OBRIR MAPA
                  </a>
                )}
                {canEdit && (
                  <>
                    <button type="button" className="boto" onClick={() => setPinning(location)}>
                      {location.latitude === null ? 'POSAR EL PIN' : 'CORREGIR EL PIN'}
                    </button>
                    <button type="button" className="boto" onClick={() => setEditing(location)}>
                      EDITAR
                    </button>
                    <AccioForm
                      action={removeLocation}
                      submitLabel="ELIMINAR"
                      submitClassName="boto boto-perill"
                      pendingLabel="…"
                      className="inline"
                      confirmText="Segur que vols eliminar aquesta ubicació?"
                      hidden={{ clientId, locationId: location.id }}
                    />
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {pinning && (
        <Panell
          title="POSAR EL PIN"
          subtitle="Les coordenades les escriu una persona. El sistema no n'inventa cap."
          onClose={() => setPinning(null)}
        >
          <AccioForm
            action={setCoordinates}
            onDone={() => setPinning(null)}
            onCancel={() => setPinning(null)}
            hidden={{ clientId, locationId: pinning.id }}
          >
            <Camp label="LATITUD" hint="Entre -90 i 90. Deixa-ho tot buit per treure el pin.">
              <input
                className="camp"
                name="latitude"
                inputMode="decimal"
                defaultValue={pinning.latitude ?? ''}
                placeholder="41.345678"
              />
            </Camp>
            <Camp label="LONGITUD" hint="Entre -180 i 180.">
              <input
                className="camp"
                name="longitude"
                inputMode="decimal"
                defaultValue={pinning.longitude ?? ''}
                placeholder="1.698765"
              />
            </Camp>
            <p className="text-[11px] text-[var(--color-ink-faint)] m-0">
              En desar, la ubicació queda marcada com a verificada per una persona.
            </p>
          </AccioForm>
        </Panell>
      )}

      {editing && (
        <Panell
          title={editing === 'nova' ? 'AFEGIR UBICACIÓ' : 'EDITAR UBICACIÓ'}
          onClose={() => setEditing(null)}
        >
          <AccioForm
            action={editing === 'nova' ? createLocation : updateLocation}
            onDone={() => setEditing(null)}
            onCancel={() => setEditing(null)}
            hidden={
              editing === 'nova' ? { clientId } : { clientId, locationId: editing.id }
            }
          >
            <Camp label="NOM">
              <input
                className="camp"
                name="name"
                defaultValue={editing === 'nova' ? '' : (editing.name ?? '')}
              />
            </Camp>
            <Camp label="TIPUS">
              <select
                className="camp"
                name="locationType"
                defaultValue={editing === 'nova' ? 'SEU' : editing.location_type}
              >
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Camp>
            <Camp label="CARRER">
              <input
                className="camp"
                name="street"
                defaultValue={editing === 'nova' ? '' : (editing.street ?? '')}
              />
            </Camp>
            <Camp label="CODI POSTAL">
              <input
                className="camp"
                name="postalCode"
                defaultValue={editing === 'nova' ? '' : (editing.postal_code ?? '')}
              />
            </Camp>
            <Camp label="MUNICIPI">
              <input
                className="camp"
                name="municipality"
                defaultValue={editing === 'nova' ? '' : (editing.municipality ?? '')}
              />
            </Camp>
            <Camp label="COMARCA">
              <input
                className="camp"
                name="comarca"
                defaultValue={editing === 'nova' ? '' : (editing.comarca ?? '')}
              />
            </Camp>
            <Camp label="PROVÍNCIA">
              <input
                className="camp"
                name="province"
                defaultValue={editing === 'nova' ? '' : (editing.province ?? '')}
              />
            </Camp>
            <Camp label="OBSERVACIONS">
              <textarea
                className="camp"
                name="notes"
                rows={2}
                defaultValue={editing === 'nova' ? '' : (editing.notes ?? '')}
              />
            </Camp>
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                name="isPrimary"
                defaultChecked={editing !== 'nova' && editing.is_primary}
              />
              UBICACIÓ PRINCIPAL
            </label>
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                name="geofenceEnabled"
                defaultChecked={editing === 'nova' ? true : editing.geofence_enabled}
              />
              GEOTANCA ACTIVADA
            </label>
            <Camp label="RADI DE LA GEOTANCA (METRES)" hint="Entre 50 i 2000.">
              <input
                className="camp"
                type="number"
                name="geofenceRadius"
                min={50}
                max={2000}
                defaultValue={editing === 'nova' ? 120 : editing.geofence_radius_m}
              />
            </Camp>
          </AccioForm>
        </Panell>
      )}
    </section>
  );
}
