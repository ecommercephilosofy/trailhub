import { afterEach, describe, expect, it } from 'vitest';
import {
  ENV_VARIABLES,
  EnvironmentError,
  OPTIONAL_VARIABLES,
  REQUIRED_SERVER_VARIABLES,
  ServerEnvOnClientError,
  integrationStatus,
  isIntegrationConfigured,
  loadPublicEnv,
  loadServerEnv,
  type EnvSource,
} from './env';

/** The minimum the brief promises is enough to boot: APP + SUPABASE. */
const MINIMAL: EnvSource = {
  NEXT_PUBLIC_APP_URL: 'https://crm.vitalpe.cat',
  APP_ENCRYPTION_KEY: 'a'.repeat(48),
  NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefgh.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
};

const FULL: EnvSource = {
  ...MINIMAL,
  MOBILE_APP_SCHEME: 'vitalpecrm',
  GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  GOOGLE_REDIRECT_URI: 'https://crm.vitalpe.cat/api/google/callback',
  GOOGLE_CALENDAR_WEBHOOK_URL: 'https://crm.vitalpe.cat/api/google/webhook',
  ANTHROPIC_API_KEY: 'sk-ant-test',
  ANTHROPIC_MODEL: 'claude-opus-4-8',
  TRANSCRIPTION_PROVIDER: 'openai',
  OPENAI_API_KEY: 'sk-openai-test',
  TRANSCRIPTION_MODEL: 'whisper-1',
  EXPO_PUBLIC_API_URL: 'https://crm.vitalpe.cat',
  EXPO_PROJECT_ID: 'expo-project',
  GEOCODING_PROVIDER: 'google',
  GOOGLE_MAPS_API_KEY: 'maps-key',
  SENTRY_DSN: 'https://public@sentry.example/1',
};

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('the .env.example catalogue', () => {
  it('lists exactly the brief’s variables', () => {
    expect(ENV_VARIABLES.map((v) => v.name).sort()).toEqual(
      [
        'ANTHROPIC_API_KEY',
        'ANTHROPIC_MODEL',
        'APP_ENCRYPTION_KEY',
        'EXPO_PROJECT_ID',
        'EXPO_PUBLIC_API_URL',
        'GEOCODING_PROVIDER',
        'GOOGLE_CALENDAR_WEBHOOK_URL',
        'GOOGLE_CLIENT_ID',
        'GOOGLE_CLIENT_SECRET',
        'GOOGLE_MAPS_API_KEY',
        'GOOGLE_REDIRECT_URI',
        'MOBILE_APP_SCHEME',
        'NEXT_PUBLIC_APP_URL',
        'NEXT_PUBLIC_SUPABASE_ANON_KEY',
        'NEXT_PUBLIC_SUPABASE_URL',
        'OPENAI_API_KEY',
        'SENTRY_DSN',
        'SUPABASE_SERVICE_ROLE_KEY',
        'TRANSCRIPTION_MODEL',
        'TRANSCRIPTION_PROVIDER',
      ].sort(),
    );
  });

  it('marks only APP and SUPABASE variables as required', () => {
    expect([...REQUIRED_SERVER_VARIABLES].sort()).toEqual(
      [
        'APP_ENCRYPTION_KEY',
        'NEXT_PUBLIC_APP_URL',
        'NEXT_PUBLIC_SUPABASE_ANON_KEY',
        'NEXT_PUBLIC_SUPABASE_URL',
        'SUPABASE_SERVICE_ROLE_KEY',
      ].sort(),
    );
    // Every integration variable is optional.
    for (const name of [
      'GOOGLE_CLIENT_ID',
      'ANTHROPIC_API_KEY',
      'OPENAI_API_KEY',
      'GOOGLE_MAPS_API_KEY',
      'EXPO_PROJECT_ID',
      'SENTRY_DSN',
    ]) {
      expect(OPTIONAL_VARIABLES).toContain(name);
    }
  });

  it('gives every variable a Catalan description', () => {
    for (const v of ENV_VARIABLES) {
      expect(v.description.length).toBeGreaterThan(20);
    }
  });
});

describe('loadServerEnv', () => {
  it('boots with only the APP and SUPABASE variables', () => {
    const env = loadServerEnv(MINIMAL);
    expect(env.NEXT_PUBLIC_APP_URL).toBe('https://crm.vitalpe.cat');
    expect(env.MOBILE_APP_SCHEME).toBe('vitalpe');
    expect(env.TRANSCRIPTION_PROVIDER).toBe('local');
    expect(env.GEOCODING_PROVIDER).toBe('none');
    expect(env.ANTHROPIC_MODEL).toBe('claude-opus-4-8');
    expect(env.TRANSCRIPTION_MODEL).toBe('whisper-1');
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('treats empty strings as unset', () => {
    const env = loadServerEnv({ ...MINIMAL, GOOGLE_CLIENT_ID: '   ', OPENAI_API_KEY: '' });
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it('never throws because of a bad optional value', () => {
    const env = loadServerEnv({
      ...MINIMAL,
      TRANSCRIPTION_PROVIDER: 'whatever',
      GEOCODING_PROVIDER: 'HERE-MAPS',
    });
    expect(env.TRANSCRIPTION_PROVIDER).toBe('local');
    expect(env.GEOCODING_PROVIDER).toBe('none');
  });

  it('accepts the full environment', () => {
    const env = loadServerEnv(FULL);
    expect(env.TRANSCRIPTION_PROVIDER).toBe('openai');
    expect(env.GEOCODING_PROVIDER).toBe('google');
    expect(env.MOBILE_APP_SCHEME).toBe('vitalpecrm');
  });

  it('reports every missing required variable at once', () => {
    try {
      loadServerEnv({ NEXT_PUBLIC_APP_URL: 'https://crm.vitalpe.cat' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentError);
      const issues = (error as EnvironmentError).issues.join('\n');
      expect(issues).toContain('NEXT_PUBLIC_SUPABASE_URL');
      expect(issues).toContain('SUPABASE_SERVICE_ROLE_KEY');
      expect(issues).toContain('APP_ENCRYPTION_KEY');
    }
  });

  it('rejects a weak encryption key and a non-URL app url', () => {
    expect(() => loadServerEnv({ ...MINIMAL, APP_ENCRYPTION_KEY: 'short' })).toThrow(EnvironmentError);
    expect(() => loadServerEnv({ ...MINIMAL, NEXT_PUBLIC_APP_URL: 'crm.vitalpe.cat' })).toThrow(
      EnvironmentError,
    );
  });

  it('refuses to run in the browser', () => {
    (globalThis as { window?: unknown }).window = {};
    expect(() => loadServerEnv(MINIMAL)).toThrow(ServerEnvOnClientError);
  });
});

describe('loadPublicEnv', () => {
  it('exposes only browser-safe values', () => {
    const env = loadPublicEnv(FULL);
    const keys = Object.keys(env);
    for (const secret of [
      'APP_ENCRYPTION_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'GOOGLE_CLIENT_SECRET',
      'ANTHROPIC_API_KEY',
      'OPENAI_API_KEY',
      'GOOGLE_MAPS_API_KEY',
    ]) {
      expect(keys).not.toContain(secret);
    }
    expect(env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe('anon-key');
  });

  it('works in the browser', () => {
    (globalThis as { window?: unknown }).window = {};
    expect(() => loadPublicEnv(MINIMAL)).not.toThrow();
  });
});

describe('integrationStatus', () => {
  it('reports the local fallback for every integration on a minimal install', () => {
    const report = integrationStatus(MINIMAL);
    const byKey = Object.fromEntries(report.map((r) => [r.key, r]));

    expect(byKey.supabase?.status).toBe('CONFIGURED');
    expect(byKey.googleCalendar?.status).toBe('NOT_CONFIGURED');
    expect(byKey.googleCalendar?.activeProvider).toBe('local');
    expect(byKey.googleCalendar?.missing).toContain('GOOGLE_CLIENT_ID');
    expect(byKey.transcription?.activeProvider).toBe('local');
    expect(byKey.interpretation?.activeProvider).toBe('local');
    expect(byKey.geocoding?.activeProvider).toBe('cap');
    expect(byKey.mobilePush?.status).toBe('NOT_CONFIGURED');
    expect(byKey.errorTracking?.status).toBe('NOT_CONFIGURED');

    // Every explanation names what to set, in Catalan.
    for (const entry of report) {
      expect(entry.explanation.length).toBeGreaterThan(20);
      if (entry.status === 'NOT_CONFIGURED' && entry.missing.length > 0) {
        expect(entry.explanation).toContain(entry.missing[0] as string);
      }
    }
  });

  it('reports everything configured on a full install', () => {
    const report = integrationStatus(FULL);
    for (const entry of report) {
      expect(entry.status, `${entry.key} should be configured`).toBe('CONFIGURED');
      expect(entry.missing).toEqual([]);
    }
  });

  it('never leaks a secret value', () => {
    const serialised = JSON.stringify(integrationStatus(FULL));
    for (const secret of ['sk-ant-test', 'sk-openai-test', 'maps-key', 'service-role-key', 'client-secret']) {
      expect(serialised).not.toContain(secret);
    }
  });

  it('treats an explicit provider choice as authoritative', () => {
    const withKeyButLocal = integrationStatus({
      ...MINIMAL,
      TRANSCRIPTION_PROVIDER: 'local',
      OPENAI_API_KEY: 'sk-openai-test',
    });
    expect(withKeyButLocal.find((r) => r.key === 'transcription')?.status).toBe('NOT_CONFIGURED');

    const inferredFromKey = integrationStatus({ ...MINIMAL, OPENAI_API_KEY: 'sk-openai-test' });
    expect(inferredFromKey.find((r) => r.key === 'transcription')?.status).toBe('CONFIGURED');
  });

  it('answers single-integration questions', () => {
    expect(isIntegrationConfigured('googleCalendar', MINIMAL)).toBe(false);
    expect(isIntegrationConfigured('googleCalendar', FULL)).toBe(true);
  });
});
