import { describe, it, expect } from 'vitest';
import { txId } from '../src/txid';

const base = { accountNumber: '12-345-6789', date: '2026-05-01', chargedAmount: -42.5, description: 'שופרסל', identifier: 0 };

describe('txId', () => {
  it('is stable for identical inputs', () => {
    expect(txId(base)).toBe(txId({ ...base }));
  });
  it('changes when any field changes', () => {
    expect(txId(base)).not.toBe(txId({ ...base, chargedAmount: -43 }));
    expect(txId(base)).not.toBe(txId({ ...base, date: '2026-05-02' }));
    expect(txId(base)).not.toBe(txId({ ...base, accountNumber: 'x' }));
  });
  it('uses the bank identifier when present to disambiguate same-day same-amount txns', () => {
    expect(txId({ ...base, identifier: 1 })).not.toBe(txId({ ...base, identifier: 2 }));
  });
});
