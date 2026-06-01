import { describe, it, expect } from 'vitest';
import { deriveKey, encrypt, decrypt } from '../src/index';

describe('crypto', () => {
  const key = deriveKey('correct horse battery staple', Buffer.alloc(16, 1));

  it('round-trips plaintext', () => {
    const blob = encrypt('hello ₪ שלום', key);
    expect(decrypt(blob, key)).toBe('hello ₪ שלום');
  });

  it('produces a different ciphertext each call (random IV)', () => {
    expect(encrypt('x', key).ciphertext).not.toBe(encrypt('x', key).ciphertext);
  });

  it('fails to decrypt with the wrong key', () => {
    const blob = encrypt('secret', key);
    const wrong = deriveKey('wrong', Buffer.alloc(16, 1));
    expect(() => decrypt(blob, wrong)).toThrow();
  });

  it('derives a 32-byte key', () => {
    expect(key).toHaveLength(32);
  });
});
