import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

export interface EncryptedBlob {
  iv: string;          // base64
  tag: string;         // base64 (GCM auth tag)
  ciphertext: string;  // base64
}

// Hardened scrypt parameters (OWASP baseline). N=2^17 makes brute-forcing a
// human passphrase costly; raising N also raises memory (~128*N*r bytes ≈ 128 MiB),
// so maxmem must be lifted above scrypt's ~32 MiB default or scryptSync throws.
const SCRYPT_PARAMS = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 } as const;
const KEY_BYTES = 32;       // AES-256
const MIN_SALT_BYTES = 16;

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) throw new Error(`key must be ${KEY_BYTES} bytes (AES-256)`);
}

/** Derive a 32-byte key from a passphrase + per-credential salt (>=16 bytes) using scrypt. */
export function deriveKey(passphrase: string, salt: Buffer): Buffer {
  if (salt.length < MIN_SALT_BYTES) {
    throw new Error(`deriveKey: salt must be at least ${MIN_SALT_BYTES} bytes`);
  }
  return scryptSync(passphrase, salt, KEY_BYTES, SCRYPT_PARAMS);
}

// Optional `aad` (associated data) is authenticated but NOT encrypted: it binds non-secret context
// (e.g. pairingId|slot|seq) to the ciphertext, so a blob can't be moved/replayed and still verify.
// Omitting `aad` is byte-for-byte the prior behavior.
export function encrypt(plaintext: string, key: Buffer, aad?: Buffer): EncryptedBlob {
  assertKey(key);
  const iv = randomBytes(12); // 96-bit nonce, recommended for GCM; fresh per call
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  if (aad) cipher.setAAD(aad);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ct.toString('base64'),
  };
}

export function decrypt(blob: EncryptedBlob, key: Buffer, aad?: Buffer): string {
  assertKey(key);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'));
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(blob.ciphertext, 'base64')),
    decipher.final(), // throws on auth-tag/AAD mismatch (wrong key, tampering, or wrong context)
  ]);
  return pt.toString('utf8');
}
