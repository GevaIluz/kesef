import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '../src/crypto';
import { deriveCoupleKeys, sealCoupleBlob, openCoupleBlob, buildShareableSummary, newPairing, makePairingToken, parsePairingToken } from '../src/couple';

describe('encrypt/decrypt with associated data (AAD)', () => {
  it('round-trips with matching AAD and throws on any AAD mismatch', () => {
    const key = Buffer.alloc(32, 1);
    const aad = Buffer.from('kesef.couple.blob/v1|pair1|A|7');
    const blob = encrypt('hello', key, aad);

    expect(decrypt(blob, key, aad)).toBe('hello');
    expect(() => decrypt(blob, key, Buffer.from('kesef.couple.blob/v1|pair1|B|7'))).toThrow();
    expect(() => decrypt(blob, key)).toThrow(); // AAD was set at seal time; omitting it must fail
  });

  it('omitting AAD stays backward compatible (round-trips, no AAD needed)', () => {
    const key = Buffer.alloc(32, 2);
    const blob = encrypt('plain', key);
    expect(decrypt(blob, key)).toBe('plain');
  });
});

describe('deriveCoupleKeys — HKDF key tree from the pairing secret', () => {
  it('derives three distinct 32-byte keys, deterministically from S_pair', () => {
    const sPair = Buffer.alloc(32, 7);
    const k = deriveCoupleKeys(sPair);
    const again = deriveCoupleKeys(sPair);

    for (const key of [k.dataKey, k.authKey, k.relayKey]) expect(key.length).toBe(32);
    // deterministic for the same secret
    expect(k.dataKey.equals(again.dataKey)).toBe(true);
    expect(k.authKey.equals(again.authKey)).toBe(true);
    // domain-separated: the three subkeys are all different
    expect(k.dataKey.equals(k.authKey)).toBe(false);
    expect(k.dataKey.equals(k.relayKey)).toBe(false);
    expect(k.authKey.equals(k.relayKey)).toBe(false);
    // a different secret yields different keys
    expect(deriveCoupleKeys(Buffer.alloc(32, 8)).dataKey.equals(k.dataKey)).toBe(false);
  });
});

describe('sealCoupleBlob / openCoupleBlob — encrypted, context-bound summary blobs', () => {
  const dataKey = deriveCoupleKeys(Buffer.alloc(32, 3)).dataKey;
  const summary = buildShareableSummary([], [], [], [], '2026-06-04', { pairingId: 'pair1', author: 'A' });
  const ctx = { pairingId: 'pair1', slot: 'A' as const, seq: 5 };

  it('round-trips: open(seal(summary)) deep-equals the summary', () => {
    const blob = sealCoupleBlob(summary, dataKey, ctx);
    expect(openCoupleBlob(blob, dataKey, ctx)).toEqual(summary);
  });

  it('binds pairingId/slot/seq via AAD — opening with different context throws', () => {
    const blob = sealCoupleBlob(summary, dataKey, ctx);
    expect(() => openCoupleBlob(blob, dataKey, { ...ctx, slot: 'B' })).toThrow();
    expect(() => openCoupleBlob(blob, dataKey, { ...ctx, pairingId: 'pairX' })).toThrow();
    expect(() => openCoupleBlob(blob, dataKey, { ...ctx, seq: 6 })).toThrow();
  });

  it('throws on a tampered ciphertext or the wrong data key', () => {
    const blob = sealCoupleBlob(summary, dataKey, ctx);
    const flipped = (blob.ciphertext[0] === 'A' ? 'B' : 'A') + blob.ciphertext.slice(1);
    expect(() => openCoupleBlob({ ...blob, ciphertext: flipped }, dataKey, ctx)).toThrow();
    const otherKey = deriveCoupleKeys(Buffer.alloc(32, 9)).dataKey;
    expect(() => openCoupleBlob(blob, otherKey, ctx)).toThrow();
  });

  it('uses a fresh nonce per seal (no key/nonce reuse even for identical input + context)', () => {
    const a = sealCoupleBlob(summary, dataKey, ctx);
    const b = sealCoupleBlob(summary, dataKey, ctx);
    expect(a.iv).not.toBe(b.iv);
  });
});

describe('pairing token — the QR/text payload that links two devices', () => {
  it('newPairing generates a 16-byte hex id and a 32-byte secret; each call is unique', () => {
    const a = newPairing();
    const b = newPairing();
    expect(a.pairingId).toMatch(/^[0-9a-f]{32}$/);
    expect(a.sPair.length).toBe(32);
    expect(a.pairingId).not.toBe(b.pairingId);
    expect(a.sPair.equals(b.sPair)).toBe(false);
  });

  it('make/parse round-trips so both devices hold the same pairingId + S_pair', () => {
    const p = newPairing();
    const token = makePairingToken(p);
    expect(token.startsWith('kesef-pair:v1:')).toBe(true);
    const parsed = parsePairingToken(token);
    expect(parsed.pairingId).toBe(p.pairingId);
    expect(parsed.sPair.equals(p.sPair)).toBe(true);
  });

  it('rejects a malformed or wrong-version token', () => {
    expect(() => parsePairingToken('https://example.com')).toThrow();
    expect(() => parsePairingToken('kesef-pair:v2:abc:def')).toThrow();
    expect(() => parsePairingToken('kesef-pair:v1:onlyid')).toThrow();          // no secret
    expect(() => parsePairingToken('kesef-pair:v1:id:c2hvcnQ=')).toThrow();      // secret not 32 bytes
  });
});
