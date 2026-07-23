import { describe, expect, it } from 'vitest';
import { REDACTED, redact, safeLogLine, scrubEmbeddedSecrets } from './redact';

describe('redact', () => {
  it('replaces values under credential-ish keys', () => {
    const out = redact({
      accessToken: 'ya29.a0ARrdaM-long-google-access-token',
      refresh_token: '1//0eXampleRefreshTokenValue',
      apiKey: 'sk-ant-api03-abcdefghijklmnop',
      password: 'hunter2',
      Authorization: 'Bearer abcdefghijklmnop',
      clientSecret: 'GOCSPX-abcdefghijk',
      companyName: 'Caves Solé Germans',
    }) as Record<string, string>;

    for (const key of [
      'accessToken',
      'refresh_token',
      'apiKey',
      'password',
      'Authorization',
      'clientSecret',
    ]) {
      expect(out[key]).toContain(REDACTED);
    }
    expect(out.companyName).toBe('Caves Solé Germans');
    const serialised = JSON.stringify(out);
    for (const secret of ['ya29.a0ARrdaM', '1//0eXample', 'sk-ant-api03', 'hunter2', 'GOCSPX-']) {
      expect(serialised).not.toContain(secret);
    }
  });

  it('redacts credential-shaped values even under an innocent key', () => {
    const out = redact({ note: 'ya29.a0ARrdaM-long-google-access-token' }) as Record<string, string>;
    expect(out.note).toContain(REDACTED);
  });

  it('scrubs secrets embedded in free text', () => {
    expect(scrubEmbeddedSecrets('Error: access_token=ya29.a0ARrdaMlongtoken is invalid')).not.toContain(
      'ya29.a0ARrdaMlongtoken',
    );
    expect(scrubEmbeddedSecrets('Incorrect API key: sk-ant-api03-abcdefghijklmnop')).not.toContain(
      'sk-ant-api03-abcdefghijklmnop',
    );
    expect(
      scrubEmbeddedSecrets('token: eyJhbGciOi.eyJzdWIiOi.SflKxwRJSMeKKF2QT4fwpMeJf36POk'),
    ).not.toContain('SflKxwRJSMeKKF2QT4fwpMeJf36POk');
    expect(scrubEmbeddedSecrets('res normal aquí')).toBe('res normal aquí');
  });

  it('redacts sensitive query parameters in a URL', () => {
    const out = redact('https://maps.googleapis.com/maps/api/geocode/json?address=Barcelona&key=SECRETKEY');
    expect(out).toContain('address=Barcelona');
    expect(out).not.toContain('SECRETKEY');
  });

  it('walks nested structures, arrays, Headers and Maps', () => {
    const headers = new Headers({ authorization: 'Bearer abcdefghijklmnop', accept: 'application/json' });
    const out = redact({
      request: { headers, retries: [{ apiKey: 'sk-abcdefghijklmnop' }] },
      map: new Map([['secret', 'value-to-hide-abcdef']]),
    });
    const serialised = JSON.stringify(out);
    expect(serialised).not.toContain('abcdefghijklmnop');
    expect(serialised).not.toContain('value-to-hide-abcdef');
    expect(serialised).toContain('application/json');
  });

  it('survives cycles', () => {
    const node: Record<string, unknown> = { name: 'a' };
    node.self = node;
    expect(() => JSON.stringify(redact(node))).not.toThrow();
    expect(JSON.stringify(redact(node))).toContain('[Circular]');
  });

  it('reduces an Error to name and a scrubbed message', () => {
    const out = redact(new Error('failed with token=ya29.a0ARrdaMlongtokenvalue')) as {
      name: string;
      message: string;
    };
    expect(out.name).toBe('Error');
    expect(out.message).not.toContain('ya29.a0ARrdaMlongtokenvalue');
  });

  it('produces a safe one-line log statement', () => {
    const line = safeLogLine('sync failed', { visitId: 'vis-1', accessToken: 'ya29.abcdefghijklmnop' });
    expect(line).toContain('sync failed');
    expect(line).toContain('vis-1');
    expect(line).not.toContain('ya29.abcdefghijklmnop');
  });

  it('leaves primitives and nullish values alone', () => {
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });
});
