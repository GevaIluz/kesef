import { describe, it, expect } from 'vitest';
import { normalizeMerchant } from '../src/merchant';

describe('normalizeMerchant', () => {
  it('bundles all Lime ride variants to one name', () => {
    expect(normalizeMerchant('LIME*5 RIDES 3VJJ +18885463345 US')).toBe('Lime');
    expect(normalizeMerchant('LIME*RIDE 3VJJ +18885463345 US')).toBe('Lime');
    expect(normalizeMerchant('LIME*4 RIDES 3VJJ')).toBe('Lime');
  });
  it('canonicalises common recurring merchants (he + en)', () => {
    expect(normalizeMerchant('WOLT')).toBe('Wolt');
    expect(normalizeMerchant('Wolt')).toBe('Wolt');
    expect(normalizeMerchant('Spotify P42E041985')).toBe('Spotify');
    expect(normalizeMerchant('NETFLIX.COM')).toBe('Netflix');
    expect(normalizeMerchant('PAYBOX')).toBe('PayBox');
    expect(normalizeMerchant('שופרסל דיל גלילות')).toBe('שופרסל');
    expect(normalizeMerchant('רמי לוי שיווק השקמה')).toBe('רמי לוי');
  });
  it('falls back to the leading text before * / phone / locale junk', () => {
    expect(normalizeMerchant('SOME SHOP*12345 +1800 US')).toBe('SOME SHOP');
    expect(normalizeMerchant('  קפה גרג   ')).toBe('קפה גרג');
  });
});
