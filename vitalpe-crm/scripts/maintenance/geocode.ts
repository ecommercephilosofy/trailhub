/**
 * Geocodes the addresses that have none.
 *
 *   pnpm geocodifica                        # simulació local
 *   pnpm geocodifica -- --apply             # local
 *   pnpm geocodifica -- --remote --apply    # producció
 *   pnpm geocodifica -- --remote --apply --limit=50
 *
 * Google's Geocoding API is the source. Three rules shape this script:
 *
 * 1. **A coordinate is never invented.** When Google returns no match, or a
 *    match so vague it is really "somewhere in this town", the row keeps its
 *    `PENDENT DE GEOLOCALITZAR` state. A rough centroid dropped on a village
 *    square would put a geofence 400 m from the cellar and make every arrival
 *    alert wrong — worse than having none.
 * 2. **A hand-placed pin wins.** `verified_by_user = true` means somebody moved
 *    the marker themselves; this never overwrites that.
 * 3. **Provenance is recorded.** `geocode_source`, `geocoded_at` and
 *    `accuracy_meters` say where each coordinate came from and how good it is.
 *
 * Re-running is free: only rows without coordinates are sent.
 */
import { loadEnv } from '../load-env';

loadEnv();

import { createGeocodingProvider, PENDING_GEOCODE } from '@vitalpe/integrations';

const argv = process.argv.slice(2).filter((a) => a !== '--');
const apply = argv.includes('--apply');
const remote = argv.includes('--remote');
const limitArg = argv.find((a) => a.startsWith('--limit='))?.split('=')[1];
const limit = Math.max(1, Math.min(2000, Number(limitArg ?? '2000') || 2000));

/**
 * Google bills per request and rate-limits bursts. 10/s is well under the quota
 * and still finishes 461 addresses in under a minute.
 */
const REQUESTS_PER_SECOND = 10;

/**
 * Anything vaguer than this is not a location, it is a town. Google reports
 * `ROOFTOP` ≈ 10 m, `RANGE_INTERPOLATED` ≈ 50 m, `GEOMETRIC_CENTER` ≈ 200 m and
 * `APPROXIMATE` ≈ 1000 m; the provider maps those to `accuracyMeters`.
 */
const MAX_ACCURACY_METERS = 250;

interface Row {
  id: string;
  client_name: string;
  street: string | null;
  postal_code: string | null;
  municipality: string | null;
  province: string | null;
}

function assertTarget(): boolean {
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  if (/localhost|127\.0\.0\.1|\[::1\]/i.test(url)) return false;
  if (!remote) {
    console.error('\n✗ DATABASE_URL és remota i no has escrit --remote.\n');
    process.exit(1);
  }
  return true;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const isRemote = assertTarget();

  const provider = createGeocodingProvider({
    ...(process.env.GEOCODING_PROVIDER ? { GEOCODING_PROVIDER: process.env.GEOCODING_PROVIDER } : {}),
    ...(process.env.GOOGLE_MAPS_API_KEY ? { GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY } : {}),
  });

  if (provider.name !== 'google') {
    console.error(
      "\n✗ No hi ha cap geocodificador configurat.\n" +
        '  Defineix GOOGLE_MAPS_API_KEY (i opcionalment GEOCODING_PROVIDER=google) a .env.local.\n' +
        "  Sense clau, aquest script no fa res: no s'inventa cap coordenada.\n",
    );
    process.exit(1);
  }

  const { default: postgres } = await import('postgres');
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('\n✗ Aquest script necessita DATABASE_URL (local o remota).\n');
    process.exit(1);
  }
  const sql = postgres(url, { max: 1, prepare: false });

  console.log(`Proveïdor: ${provider.name}`);
  console.log(`Base de dades: ${isRemote ? 'REMOTA' : 'local'}${apply ? '' : ' (simulació)'}`);

  try {
    const rows = await sql<Row[]>`
      select l.id, c.name as client_name, l.street, l.postal_code, l.municipality, l.province
        from public.client_locations l
        join public.clients c on c.id = l.client_id
       where l.deleted_at is null
         and l.latitude is null
         and not l.verified_by_user
         and coalesce(btrim(l.street), '') <> ''
       order by c.in_working_list desc, c.name
       limit ${limit}`;

    console.log(`\nAdreces per geocodificar: ${rows.length}`);
    if (rows.length === 0) {
      console.log('\n✓ No hi ha res pendent.\n');
      return;
    }

    if (!apply) {
      console.log('\n  Simulació: no es crida Google ni es desa res.');
      console.log('  Primeres 5 que s\'enviarien:');
      for (const row of rows.slice(0, 5)) {
        console.log(
          `    · ${row.client_name} — ${[row.street, row.postal_code, row.municipality].filter(Boolean).join(', ')}`,
        );
      }
      console.log(
        `\n  Cost estimat a Google: ~${(rows.length * 0.005).toFixed(2)} USD ` +
          `(${rows.length} peticions a 5 USD/1000; hi ha 200 USD/mes de crèdit gratuït).`,
      );
      console.log('  Per executar-ho: afegeix --apply.\n');
      return;
    }

    let located = 0;
    let tooVague = 0;
    let noMatch = 0;
    let failed = 0;

    for (const [index, row] of rows.entries()) {
      if (index > 0 && index % REQUESTS_PER_SECOND === 0) await sleep(1000);

      const result = await provider.geocode({
        address: row.street ?? '',
        ...(row.postal_code ? { postalCode: row.postal_code } : {}),
        ...(row.municipality ? { municipality: row.municipality } : {}),
        ...(row.province ? { province: row.province } : {}),
        country: 'ES',
      });

      if (result.status === PENDING_GEOCODE) {
        if (result.reason === 'NO_MATCH' || result.reason === 'AMBIGUOUS') noMatch += 1;
        else failed += 1;
        // The reason is written to the row so the UI can say WHY it is still
        // pending instead of just that it is.
        await sql`
          update public.client_locations
             set geocode_source = ${`${provider.name}: ${result.reason}`},
                 geocoded_at = now(), updated_at = now()
           where id = ${row.id}`;
        continue;
      }

      const accuracy = result.accuracyMeters ?? null;
      if (accuracy !== null && accuracy > MAX_ACCURACY_METERS) {
        // A town-level centroid is not an address. Recording it would make the
        // map look complete and the geofences useless.
        tooVague += 1;
        await sql`
          update public.client_locations
             set geocode_source = ${`${provider.name}: MASSA IMPRECÍS (${Math.round(accuracy)} m)`},
                 geocoded_at = now(), updated_at = now()
           where id = ${row.id}`;
        continue;
      }

      await sql`
        update public.client_locations
           set latitude = ${result.latitude},
               longitude = ${result.longitude},
               formatted_address = ${result.formattedAddress},
               accuracy_meters = ${accuracy},
               geocode_source = ${result.source},
               geocoded_at = ${result.geocodedAt},
               updated_at = now()
         where id = ${row.id} and not verified_by_user`;
      located += 1;

      if ((index + 1) % 50 === 0) {
        console.log(`  … ${index + 1}/${rows.length} processades`);
      }
    }

    console.log('\n══ Geocodificació ══');
    console.log(`  Localitzades          : ${located}`);
    console.log(`  Massa imprecises      : ${tooVague}  (queden PENDENT: un centroide de poble no és una adreça)`);
    console.log(`  Sense coincidència    : ${noMatch}`);
    console.log(`  Errors del proveïdor  : ${failed}`);
    console.log(`  Cost aproximat        : ~${(rows.length * 0.005).toFixed(2)} USD\n`);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error('\n✗', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
