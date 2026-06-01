import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

export interface EncryptedBlob {
  iv: string;          // base64
  tag: string;         // base64 (GCM auth tag)
  ciphertext: string;  // base64
}

/** Derive a 32-byte key from a passphrase + salt using scrypt. */
export function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32);
}

export function encrypt(plaintext: string, key: Buffer): EncryptedBlob {
  const iv = randomBytes(12); // 96-bit nonce, recommended for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ct.toString('base64'),
  };
}

export function decrypt(blob: EncryptedBlob, key: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(blob.ciphertext, 'base64')),
    decipher.final(), // throws on auth-tag mismatch (wrong key / tampering)
  ]);
  return pt.toString('utf8');
}
