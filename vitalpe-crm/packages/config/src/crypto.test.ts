import { afterEach, describe, expect, it } from 'vitest';
import {
  CIPHER_VERSION,
  CryptoError,
  DecryptionError,
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
} from './crypto';

const KEY = 'k'.repeat(48);
const OTHER_KEY = 'x'.repeat(48);

/** Flips one bit of a base64 field inside the envelope. */
function tamper(envelope: string, field: 'iv' | 'tag' | 'ciphertext'): string {
  const parts = envelope.split(':');
  const index = { iv: 1, tag: 2, ciphertext: 3 }[field];
  const buf = Buffer.from(parts[index] as string, 'base64');
  buf[0] = (buf[0] as number) ^ 0b0000_0001;
  parts[index] = buf.toString('base64');
  return parts.join(':');
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a value', () => {
    const plain = 'ya29.a0ARrdaM-google-refresh-token';
    const cipher = encryptSecret(plain, KEY);
    expect(cipher.startsWith(`${CIPHER_VERSION}:`)).toBe(true);
    expect(cipher).not.toContain(plain);
    expect(decryptSecret(cipher, KEY)).toBe(plain);
  });

  it('round-trips unicode and empty strings', () => {
    for (const plain of ['', 'Àngel Solé — Caves i Vins, S.L.', '🔐']) {
      expect(decryptSecret(encryptSecret(plain, KEY), KEY)).toBe(plain);
    }
  });

  it('produces a different envelope every time (random IV)', () => {
    const a = encryptSecret('same', KEY);
    const b = encryptSecret('same', KEY);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, KEY)).toBe(decryptSecret(b, KEY));
  });

  it('rejects a flipped byte in the ciphertext', () => {
    const cipher = encryptSecret('token-secret-value', KEY);
    expect(() => decryptSecret(tamper(cipher, 'ciphertext'), KEY)).toThrow(DecryptionError);
  });

  it('rejects a flipped byte in the auth tag', () => {
    const cipher = encryptSecret('token-secret-value', KEY);
    expect(() => decryptSecret(tamper(cipher, 'tag'), KEY)).toThrow(DecryptionError);
  });

  it('rejects a flipped byte in the IV', () => {
    const cipher = encryptSecret('token-secret-value', KEY);
    expect(() => decryptSecret(tamper(cipher, 'iv'), KEY)).toThrow(DecryptionError);
  });

  it('rejects the wrong key', () => {
    const cipher = encryptSecret('token-secret-value', KEY);
    expect(() => decryptSecret(cipher, OTHER_KEY)).toThrow(DecryptionError);
  });

  it('rejects a malformed or unknown envelope', () => {
    expect(() => decryptSecret('not-an-envelope', KEY)).toThrow(DecryptionError);
    expect(() => decryptSecret('v2:a:b:c', KEY)).toThrow(DecryptionError);
    expect(() => decryptSecret('', KEY)).toThrow(DecryptionError);
    const cipher = encryptSecret('x', KEY);
    const [, iv, tag, ct] = cipher.split(':');
    // Truncated IV.
    expect(() => decryptSecret(`v1:${Buffer.from('short').toString('base64')}:${tag}:${ct}`, KEY)).toThrow(
      DecryptionError,
    );
    // Truncated tag.
    expect(() => decryptSecret(`v1:${iv}:${Buffer.from('short').toString('base64')}:${ct}`, KEY)).toThrow(
      DecryptionError,
    );
  });

  it('refuses a missing or too-short key', () => {
    expect(() => encryptSecret('x', '')).toThrow(CryptoError);
    expect(() => encryptSecret('x', 'too-short')).toThrow(CryptoError);
  });

  it('refuses to run in the browser', () => {
    (globalThis as { window?: unknown }).window = {};
    expect(() => encryptSecret('x', KEY)).toThrow(CryptoError);
    expect(() => decryptSecret('v1:a:b:c', KEY)).toThrow(CryptoError);
  });
});

describe('isEncryptedSecret', () => {
  it('recognises well-formed envelopes only', () => {
    expect(isEncryptedSecret(encryptSecret('x', KEY))).toBe(true);
    expect(isEncryptedSecret('plaintext')).toBe(false);
    expect(isEncryptedSecret('v2:a:b:c')).toBe(false);
    expect(isEncryptedSecret(undefined)).toBe(false);
    expect(isEncryptedSecret(42)).toBe(false);
  });
});
