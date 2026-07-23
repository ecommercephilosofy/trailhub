/**
 * Application-boundary secret encryption.
 *
 * Google OAuth tokens (and anything else stored in a `*_enc` column) are
 * encrypted here before they touch the database and decrypted here after they
 * come back. The database never sees plaintext and the `client` role cannot
 * even select the columns — see the column-level revoke in the RLS migration.
 *
 * ## Format
 *
 *     v1:<iv base64>:<auth tag base64>:<ciphertext base64>
 *
 * AES-256-GCM with a 12-byte random IV per message and a 16-byte auth tag.
 * The key is derived from `APP_ENCRYPTION_KEY` with scrypt.
 *
 * ## Why a fixed salt
 *
 * The envelope has no room for a per-message salt, so the salt is a constant
 * tied to the cipher version. That is acceptable here because the input is a
 * high-entropy application secret (≥32 chars, generated once with
 * `openssl rand -base64 48`), not a user-chosen password: scrypt is being used
 * as a key-stretching KDF for domain separation, not to make a weak password
 * expensive to brute-force. Per-message randomness lives in the IV, which is
 * where GCM needs it. Rotating the key means bumping the version prefix and
 * re-encrypting; the parser rejects any prefix it does not know.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const CIPHER_VERSION = 'v1' as const;

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** Domain-separation salt for v1. Never change without bumping the version. */
const KDF_SALT = Buffer.from('vitalpe-crm/secret-box/v1', 'utf8');
const MIN_KEY_LENGTH = 32;

export class CryptoError extends Error {
  override readonly name: string = 'CryptoError';
}

export class DecryptionError extends CryptoError {
  override readonly name = 'DecryptionError';
}

function assertServerOnly(what: string): void {
  if (typeof window !== 'undefined') {
    throw new CryptoError(
      `${what} només es pot executar al servidor. Els secrets xifrats mai poden ` +
        "passar pel navegador: mou aquesta crida a una funció de servidor.",
    );
  }
}

/** Derived keys are memoised: scrypt is deliberately slow. */
const keyCache = new Map<string, Buffer>();

function deriveKey(secret: string): Buffer {
  const cached = keyCache.get(secret);
  if (cached) return cached;
  const key = scryptSync(Buffer.from(secret, 'utf8'), KDF_SALT, KEY_BYTES);
  keyCache.set(secret, key);
  return key;
}

function resolveSecret(explicit?: string): string {
  const secret = explicit ?? (typeof process === 'undefined' ? undefined : process.env.APP_ENCRYPTION_KEY);
  if (typeof secret !== 'string' || secret.trim().length === 0) {
    throw new CryptoError(
      "Falta APP_ENCRYPTION_KEY. És obligatòria per xifrar els secrets desats a la base de dades: genera-la amb `openssl rand -base64 48`.",
    );
  }
  if (secret.length < MIN_KEY_LENGTH) {
    throw new CryptoError(
      `APP_ENCRYPTION_KEY ha de tenir com a mínim ${MIN_KEY_LENGTH} caràcters.`,
    );
  }
  return secret;
}

/**
 * Encrypts a UTF-8 string. Returns `v1:<iv>:<tag>:<ciphertext>`, all base64.
 *
 * @param plain  the secret to protect
 * @param key    override for `APP_ENCRYPTION_KEY` (tests, key rotation)
 */
export function encryptSecret(plain: string, key?: string): string {
  assertServerOnly('encryptSecret()');
  if (typeof plain !== 'string') {
    throw new CryptoError('encryptSecret() només accepta cadenes de text.');
  }
  const derived = deriveKey(resolveSecret(key));
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, derived, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    CIPHER_VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

/**
 * Decrypts a value produced by {@link encryptSecret}.
 *
 * Throws {@link DecryptionError} when the envelope is malformed, when the
 * ciphertext or the tag has been tampered with, or when the key is wrong —
 * all three are indistinguishable to a caller by design.
 */
export function decryptSecret(cipherText: string, key?: string): string {
  assertServerOnly('decryptSecret()');
  const parsed = parseEnvelope(cipherText);
  const derived = deriveKey(resolveSecret(key));

  let decipher;
  try {
    decipher = createDecipheriv(ALGORITHM, derived, parsed.iv);
    decipher.setAuthTag(parsed.tag);
  } catch (cause) {
    throw new DecryptionError('El secret xifrat no és vàlid.', { cause });
  }

  try {
    return Buffer.concat([decipher.update(parsed.ciphertext), decipher.final()]).toString('utf8');
  } catch (cause) {
    // GCM authentication failed: tampered ciphertext/tag, or the wrong key.
    throw new DecryptionError(
      "No s'ha pogut desxifrar el secret: la clau no és correcta o el valor s'ha manipulat.",
      { cause },
    );
  }
}

/** Cheap shape check — does not prove the value decrypts. */
export function isEncryptedSecret(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    parseEnvelope(value);
    return true;
  } catch {
    return false;
  }
}

interface Envelope {
  iv: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
}

function parseEnvelope(value: string): Envelope {
  if (typeof value !== 'string' || value.length === 0) {
    throw new DecryptionError('El secret xifrat és buit.');
  }
  const parts = value.split(':');
  if (parts.length !== 4) {
    throw new DecryptionError(
      'Format de secret xifrat desconegut: s’esperava v1:<iv>:<tag>:<contingut>.',
    );
  }
  const [version, ivB64, tagB64, ctB64] = parts as [string, string, string, string];
  if (!constantTimeStringEqual(version, CIPHER_VERSION)) {
    throw new DecryptionError(`Versió de xifratge no suportada: «${version}».`);
  }
  const iv = decodeBase64(ivB64, 'iv');
  const tag = decodeBase64(tagB64, 'tag');
  const ciphertext = decodeBase64(ctB64, 'contingut');
  if (iv.length !== IV_BYTES) {
    throw new DecryptionError(`El vector d'inicialització ha de tenir ${IV_BYTES} bytes.`);
  }
  if (tag.length !== TAG_BYTES) {
    throw new DecryptionError(`L'etiqueta d'autenticació ha de tenir ${TAG_BYTES} bytes.`);
  }
  return { iv, tag, ciphertext };
}

function decodeBase64(value: string, label: string): Buffer {
  const buf = Buffer.from(value, 'base64');
  // Buffer.from is lenient: re-encoding catches garbage that silently decoded.
  if (buf.length === 0 && value.length > 0) {
    throw new DecryptionError(`El camp «${label}» no és base64 vàlid.`);
  }
  return buf;
}

function constantTimeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
