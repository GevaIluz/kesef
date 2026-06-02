import { describe, it, expect } from 'vitest';
import { mapScrapeResult } from '../src/map';

const result = {
  success: true,
  accounts: [{
    accountNumber: '410-12345',
    balance: 42300,
    txns: [
      { type: 'normal', identifier: 11, date: '2026-05-01T00:00:00Z', chargedAmount: -342.8, originalAmount: -342.8, originalCurrency: 'ILS', description: 'שופרסל', status: 'completed' },
      { type: 'normal', identifier: 12, date: '2026-05-02T00:00:00Z', chargedAmount: 24000, originalAmount: 24000, originalCurrency: 'ILS', description: 'משכורת', status: 'completed' },
    ],
  }],
};

describe('mapScrapeResult', () => {
  const out = mapScrapeResult(result as any, { now: '2026-05-03' });
  it('produces one account with a beinleumi institution', () => {
    expect(out.accounts).toHaveLength(1);
    expect(out.accounts[0]!.institution).toBe('beinleumi');
    expect(out.accounts[0]!.type).toBe('bank');
    expect(out.accounts[0]!.currency).toBe('ILS');
    expect(out.accounts[0]!.shareable).toBe(false);
  });
  it('maps txns with signed amounts and ISO date (date-only)', () => {
    expect(out.transactions).toHaveLength(2);
    const groceries = out.transactions.find(t => t.description === 'שופרסל')!;
    expect(groceries.amount).toBe(-342.8);
    expect(groceries.date).toBe('2026-05-01');
    expect(groceries.accountId).toBe(out.accounts[0]!.id);
  });
  it('emits a balance snapshot dated now', () => {
    expect(out.snapshots).toHaveLength(1);
    expect(out.snapshots[0]!.balance).toBe(42300);
    expect(out.snapshots[0]!.date).toBe('2026-05-03');
  });
});
