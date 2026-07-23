import { describe, expect, it } from 'vitest';
import {
  activitySchema,
  clientLocationSchema,
  clientSchema,
  contactSchema,
  opportunitySchema,
} from './crm.js';
import { parseOrThrow, safeParse, ValidationError } from './errors.js';

const CLIENT = '11111111-1111-4111-8111-111111111111';
const PRODUCT = '22222222-2222-4222-8222-222222222222';
const CAMPAIGN = '33333333-3333-4333-8333-333333333333';

const messagesOf = (schema: Parameters<typeof safeParse>[0], data: unknown): string[] => {
  const result = safeParse(schema, data);
  return result.success ? [] : result.error.issues.map((i) => `${i.path}: ${i.message}`);
};

describe('clientSchema', () => {
  it('accepts a minimal company', () => {
    const parsed = parseOrThrow(clientSchema, { name: 'Masia Romagosa S.L.' });
    expect(parsed.name).toBe('Masia Romagosa S.L.');
    expect(parsed.country).toBe('ES');
    expect(parsed.verification_status).toBe('PENDENT DE VERIFICAR');
  });

  it('requires a name (clients_name_not_blank)', () => {
    expect(messagesOf(clientSchema, {})).toContain('name: El nom de l’empresa és obligatori.');
    expect(messagesOf(clientSchema, { name: '   ' })).toContain(
      'name: El nom de l’empresa és obligatori.',
    );
  });

  it('requires an explanation for client type ALTRES', () => {
    expect(
      messagesOf(clientSchema, { name: 'X', client_type_code: 'ALTRES' }),
    ).toContain('other_client_type: Amb el tipus «ALTRES» cal explicar de quin tipus d’empresa es tracta.');
    expect(
      safeParse(clientSchema, {
        name: 'X',
        client_type_code: 'ALTRES',
        other_client_type: 'Distribuïdor',
      }).success,
    ).toBe(true);
  });

  it('accepts the other client types without an explanation', () => {
    expect(safeParse(clientSchema, { name: 'X', client_type_code: 'ELABORADOR' }).success).toBe(
      true,
    );
  });

  it('requires a reason for NO POTENCIAL', () => {
    expect(
      messagesOf(clientSchema, { name: 'X', confirmed_classification: 'NO POTENCIAL' }),
    ).toContain('not_potential_reason: Per marcar una empresa com a «NO POTENCIAL» cal indicar-ne el motiu.');
    expect(
      safeParse(clientSchema, {
        name: 'X',
        confirmed_classification: 'NO POTENCIAL',
        not_potential_reason: 'Ha tancat',
      }).success,
    ).toBe(true);
  });

  it('does not require a reason for the other classifications', () => {
    expect(
      safeParse(clientSchema, { name: 'X', confirmed_classification: 'ACTIU SEGUR' }).success,
    ).toBe(true);
  });

  it('rejects a classification outside the enum', () => {
    expect(safeParse(clientSchema, { name: 'X', confirmed_classification: 'ACTIVO' }).success).toBe(
      false,
    );
  });

  it('has no field for the proposed classification — only the engine writes that', () => {
    const parsed = parseOrThrow(clientSchema, { name: 'X' }) as Record<string, unknown>;
    expect('proposed_classification' in parsed).toBe(false);
  });

  it('reports both cross-field problems at once', () => {
    const messages = messagesOf(clientSchema, {
      name: 'X',
      client_type_code: 'ALTRES',
      confirmed_classification: 'NO POTENCIAL',
    });
    expect(messages).toHaveLength(2);
  });
});

describe('contactSchema', () => {
  it('accepts a contact identified by any single field', () => {
    for (const identity of [
      { first_name: 'Jordi' },
      { last_name: 'Ferrer' },
      { email_original: 'jordi@celler.cat' },
      { phone_original: '938912345' },
    ]) {
      expect(safeParse(contactSchema, { client_id: CLIENT, ...identity }).success).toBe(true);
    }
  });

  it('rejects a contact with no identity at all', () => {
    expect(messagesOf(contactSchema, { client_id: CLIENT })).toContain(
      'first_name: Un contacte necessita com a mínim un nom, un cognom, un correu o un telèfon.',
    );
    expect(
      messagesOf(contactSchema, {
        client_id: CLIENT,
        first_name: '  ',
        last_name: '',
        email_original: '   ',
        phone_original: '',
      }),
    ).toHaveLength(1);
  });

  it('requires a valid client id', () => {
    expect(safeParse(contactSchema, { client_id: 'nope', first_name: 'Jordi' }).success).toBe(false);
  });
});

describe('clientLocationSchema', () => {
  it('accepts coordinates as a pair', () => {
    expect(
      safeParse(clientLocationSchema, { client_id: CLIENT, latitude: 41.3, longitude: 1.7 }).success,
    ).toBe(true);
  });

  it('accepts no coordinates at all', () => {
    expect(safeParse(clientLocationSchema, { client_id: CLIENT }).success).toBe(true);
  });

  it('rejects a half-geocoded location', () => {
    expect(messagesOf(clientLocationSchema, { client_id: CLIENT, latitude: 41.3 })).toContain(
      'longitude: Les coordenades van en parella: o latitud i longitud, o cap de les dues.',
    );
    expect(messagesOf(clientLocationSchema, { client_id: CLIENT, longitude: 1.7 })).toContain(
      'latitude: Les coordenades van en parella: o latitud i longitud, o cap de les dues.',
    );
  });

  it('keeps the geofence radius between 50 and 2000 metres', () => {
    expect(
      safeParse(clientLocationSchema, { client_id: CLIENT, geofence_radius_m: 50 }).success,
    ).toBe(true);
    expect(
      safeParse(clientLocationSchema, { client_id: CLIENT, geofence_radius_m: 2000 }).success,
    ).toBe(true);
    expect(
      safeParse(clientLocationSchema, { client_id: CLIENT, geofence_radius_m: 49 }).success,
    ).toBe(false);
    expect(
      safeParse(clientLocationSchema, { client_id: CLIENT, geofence_radius_m: 2001 }).success,
    ).toBe(false);
    expect(
      safeParse(clientLocationSchema, { client_id: CLIENT, geofence_radius_m: 120.5 }).success,
    ).toBe(false);
  });

  it('defaults the radius to 120, like the column', () => {
    expect(parseOrThrow(clientLocationSchema, { client_id: CLIENT }).geofence_radius_m).toBe(120);
  });

  it('keeps latitude and longitude inside their ranges', () => {
    expect(
      safeParse(clientLocationSchema, { client_id: CLIENT, latitude: 91, longitude: 0 }).success,
    ).toBe(false);
    expect(
      safeParse(clientLocationSchema, { client_id: CLIENT, latitude: 0, longitude: 181 }).success,
    ).toBe(false);
  });
});

describe('opportunitySchema', () => {
  const base = {
    client_id: CLIENT,
    product_id: PRODUCT,
    campaign_id: CAMPAIGN,
    data_type: 'COMPRA REAL' as const,
  };

  it('accepts a null volume', () => {
    expect(safeParse(opportunitySchema, { ...base, volume_liters: null }).success).toBe(true);
    expect(safeParse(opportunitySchema, base).success).toBe(true);
  });

  it('rejects a volume of zero or less', () => {
    expect(messagesOf(opportunitySchema, { ...base, volume_liters: 0 })).toContain(
      'volume_liters: El volum ha de ser més gran que 0.',
    );
    expect(safeParse(opportunitySchema, { ...base, volume_liters: -5 }).success).toBe(false);
  });

  it('requires an observation when the forecast is ALTRES', () => {
    expect(messagesOf(opportunitySchema, { ...base, forecast_next: 'ALTRES' })).toContain(
      'notes: Amb la previsió «ALTRES» cal escriure una observació que l’expliqui.',
    );
    expect(
      safeParse(opportunitySchema, { ...base, forecast_next: 'ALTRES', notes: 'Volen granel BIB' })
        .success,
    ).toBe(true);
  });

  it('does not require notes for the other forecasts', () => {
    expect(safeParse(opportunitySchema, { ...base, forecast_next: 'REPETIR COMANDA' }).success).toBe(
      true,
    );
  });

  it('keeps the probability between 0 and 100', () => {
    expect(safeParse(opportunitySchema, { ...base, probability: 101 }).success).toBe(false);
    expect(safeParse(opportunitySchema, { ...base, probability: 0 }).success).toBe(true);
  });

  it('accepts only the three data types from the enum', () => {
    expect(safeParse(opportunitySchema, { ...base, data_type: 'PREVISIÓ CONFIRMADA' }).success).toBe(
      false,
    );
    expect(safeParse(opportunitySchema, { ...base, data_type: 'PREVISIO CONFIRMADA' }).success).toBe(
      true,
    );
  });
});

describe('activitySchema', () => {
  const base = { client_id: CLIENT, activity_type: 'TRUCADA' as const };

  it('accepts an activity with no result', () => {
    expect(safeParse(activitySchema, base).success).toBe(true);
  });

  it('requires an observation when the result is ALTRES', () => {
    expect(messagesOf(activitySchema, { ...base, result: 'ALTRES' })).toContain(
      'notes: Amb el resultat «ALTRES» cal escriure una observació que l’expliqui.',
    );
    expect(messagesOf(activitySchema, { ...base, result: 'ALTRES', notes: '   ' })).toHaveLength(1);
    expect(
      safeParse(activitySchema, { ...base, result: 'ALTRES', notes: 'Ens deriven al grup' }).success,
    ).toBe(true);
  });

  it('does not require notes for the other results', () => {
    expect(safeParse(activitySchema, { ...base, result: 'DEMANA PREUS' }).success).toBe(true);
  });

  it('validates the occurred_on format', () => {
    expect(safeParse(activitySchema, { ...base, occurred_on: '2026-07-23' }).success).toBe(true);
    expect(safeParse(activitySchema, { ...base, occurred_on: '23/07/2026' }).success).toBe(false);
  });
});

describe('parseOrThrow / safeParse', () => {
  it('throws a ValidationError carrying every issue', () => {
    try {
      parseOrThrow(
        clientSchema,
        { name: 'X', client_type_code: 'ALTRES', confirmed_classification: 'NO POTENCIAL' },
        'formulari d’empresa',
      );
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const validation = error as ValidationError;
      expect(validation.issues.length).toBe(2);
      expect(validation.issues.map((i) => i.path).sort()).toEqual([
        'not_potential_reason',
        'other_client_type',
      ]);
      expect(validation.context).toBe('formulari d’empresa');
      expect(validation.message).toContain('Dades no vàlides a formulari d’empresa');
    }
  });

  it('never throws from safeParse', () => {
    const result = safeParse(clientSchema, null);
    expect(result.success).toBe(false);
  });

  it('reports missing fields in Catalan, not in English', () => {
    const result = safeParse(contactSchema, {});
    expect(result.success).toBe(false);
    if (result.success) return;
    const message = result.error.issues.map((i) => i.message).join(' ');
    expect(message).toMatch(/obligatori|Identificador/);
    expect(message).not.toMatch(/Required|Expected/);
  });

  it('reports an out-of-enum value with the list of valid values, in Catalan', () => {
    const result = safeParse(activitySchema, { client_id: CLIENT, activity_type: 'PHONE CALL' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.message).toContain('Valor no permès');
    expect(result.error.issues[0]?.message).toContain('TRUCADA');
  });
});
