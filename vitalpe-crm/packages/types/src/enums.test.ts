import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as enums from './enums.js';

/**
 * The enum arrays in this package are transcriptions of `create type app.* as
 * enum (...)`. Rather than trust the transcription, this suite READS the
 * migration and compares, value by value and in order.
 *
 * That is what catches the tempting "fixes": PREVISIO -> PREVISIÓ, the Catalan
 * middle dot in CANCEL·LAT turned into a full stop, a value reordered. Any of
 * them would produce a string PostgreSQL rejects at write time.
 */

const CORE_SQL = fileURLToPath(
  new URL('../../../supabase/migrations/20260723090000_core.sql', import.meta.url),
);

function sqlEnums(): Map<string, string[]> {
  const sql = readFileSync(CORE_SQL, 'utf8');
  const out = new Map<string, string[]>();
  const declaration = /create type app\.(\w+) as enum\s*\(([\s\S]*?)\)\s*;/g;
  let match: RegExpExecArray | null;
  while ((match = declaration.exec(sql)) !== null) {
    const name = match[1] as string;
    const body = match[2] as string;
    const values = [...body.matchAll(/'((?:[^']|'')*)'/g)].map((m) =>
      (m[1] as string).replace(/''/g, "'"),
    );
    out.set(name, values);
  }
  return out;
}

/** SQL type name -> the exported runtime array meant to mirror it. */
const MIRRORS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['user_role', enums.USER_ROLES],
  ['membership_status', enums.MEMBERSHIP_STATUSES],
  ['invitation_status', enums.INVITATION_STATUSES],
  ['classification', enums.CLASSIFICATIONS],
  ['verification_status', enums.VERIFICATION_STATUSES],
  ['contact_type', enums.CONTACT_TYPES],
  ['location_type', enums.LOCATION_TYPES],
  ['opportunity_data_type', enums.OPPORTUNITY_DATA_TYPES],
  ['forecast_next', enums.FORECAST_NEXT_VALUES],
  ['opportunity_status', enums.OPPORTUNITY_STATUSES],
  ['activity_type', enums.ACTIVITY_TYPES],
  ['activity_result', enums.ACTIVITY_RESULTS],
  ['task_kind', enums.TASK_KINDS],
  ['task_status', enums.TASK_STATUSES],
  ['task_priority', enums.TASK_PRIORITIES],
  ['commercial_action', enums.COMMERCIAL_ACTIONS],
  ['sample_subtype', enums.SAMPLE_SUBTYPES],
  ['visit_status', enums.VISIT_STATUSES],
  ['sync_status', enums.SYNC_STATUSES],
  ['change_origin', enums.CHANGE_ORIGINS],
  ['voice_stage_status', enums.VOICE_STAGE_STATUSES],
  ['geofence_event_type', enums.GEOFENCE_EVENT_TYPES],
  ['import_status', enums.IMPORT_STATUSES],
  ['dedupe_decision', enums.DEDUPE_DECISIONS],
];

describe('enums mirror the SQL exactly', () => {
  const parsed = sqlEnums();

  it('found every enum declared in the core migration', () => {
    expect(parsed.size).toBe(MIRRORS.length);
  });

  it.each(MIRRORS.map(([name, values]) => [name, values] as const))(
    'app.%s',
    (name, values) => {
      expect(parsed.get(name), `app.${name} not found in the migration`).toBeDefined();
      expect([...values]).toEqual(parsed.get(name));
    },
  );
});

describe('the spellings that look wrong but are not', () => {
  it('keeps PREVISIO without an accent', () => {
    expect(enums.OPPORTUNITY_DATA_TYPES).toContain('PREVISIO CONFIRMADA');
  });

  it('uses U+00B7 MIDDLE DOT in CANCEL·LAT and CANCEL·LADA', () => {
    expect(enums.TASK_STATUSES).toContain('CANCEL·LAT');
    expect(enums.VISIT_STATUSES).toContain('CANCEL·LADA');
  });

  it('keeps the unaccented commercial vocabulary', () => {
    expect(enums.ACTIVITY_RESULTS).toContain('INTERES CONCRET');
    expect(enums.ACTIVITY_RESULTS).toContain('TE UN ALTRE PROVEIDOR');
    expect(enums.ACTIVITY_RESULTS).toContain('REPETIRA COMANDA');
    expect(enums.ACTIVITY_RESULTS).toContain('NO COMPRARA');
    expect(enums.CHANGE_ORIGINS).toContain('IMPORTACIO');
    expect(enums.CHANGE_ORIGINS).toContain('MOBIL');
    expect(enums.VOICE_STAGE_STATUSES).toContain('EN PROCES');
  });

  it('keeps the spaces around the slash in TANCAT / INACTIU', () => {
    expect(enums.ACTIVITY_RESULTS).toContain('TANCAT / INACTIU');
  });
});

describe('sets that live in CHECK constraints', () => {
  it('matches products.category', () => {
    expect([...enums.PRODUCT_CATEGORIES]).toEqual([
      'BASE CAVA',
      'DO PENEDES',
      'DO CATALUNYA',
      'ALTRES / SENSE DO',
    ]);
  });

  it('matches geofence_events.confidence', () => {
    expect([...enums.ARRIVAL_CONFIDENCES]).toEqual(['ALTA', 'MITJANA', 'BAIXA', 'AMBIGUA']);
  });

  it('matches the seeded client_types', () => {
    expect([...enums.CLIENT_TYPE_CODES]).toEqual([
      'EMBOTELLADOR',
      'ELABORADOR',
      'COOPERATIVA',
      'ALTRES',
    ]);
  });
});

describe('runtime arrays', () => {
  it('every array is frozen at the type level and has no duplicates', () => {
    for (const [name, values] of MIRRORS) {
      expect(new Set(values).size, `${name} has duplicate values`).toBe(values.length);
    }
  });
});
