import { describe, it, expect } from 'vitest';
import { buildShareableSummary } from '../src/couple';
import { normalizeMerchant } from '../src/index';
import type { Account, BalanceSnapshot, Goal, Transaction } from '../src/index';

const acct = (over: Partial<Account>): Account => ({
  id: 'a', institution: 'beinleumi', type: 'bank', displayName: 'A', currency: 'ILS', shareable: false, ...over,
});
const snap = (accountId: string, balance: number, date: string): BalanceSnapshot => ({
  id: `${accountId}@${date}`, accountId, date, balance,
});

describe('buildShareableSummary — what leaves the device', () => {
  it('includes only accounts flagged shareable, with type/label/balance/asOf', () => {
    const accounts = [
      acct({ id: 'a1', type: 'bank', displayName: 'עו"ש', shareable: true }),
      acct({ id: 'a2', institution: 'cal', type: 'credit_card', displayName: 'Cal', shareable: false }),
    ];
    const snaps = [snap('a1', 42200, '2026-06-01'), snap('a2', -3000, '2026-06-01')];

    const summary = buildShareableSummary(accounts, [], snaps, [], '2026-06-04', { pairingId: 'p1', author: 'A' });

    expect(summary.accounts).toEqual([
      { type: 'bank', label: 'עו"ש', balance: 42200, asOf: '2026-06-01' },
    ]);
  });

  it('stamps the envelope: schema, pairingId, author, currency, generatedAt', () => {
    const summary = buildShareableSummary([], [], [], [], '2026-06-04', { pairingId: 'p1', author: 'B' });
    expect(summary.schema).toBe('kesef.couple.summary/v1');
    expect(summary.pairingId).toBe('p1');
    expect(summary.author).toBe('B');
    expect(summary.currency).toBe('ILS');
    expect(summary.generatedAt).toBe('2026-06-04');
  });

  it('defaults author to "A" when not supplied', () => {
    const summary = buildShareableSummary([], [], [], [], '2026-06-04', { pairingId: 'p1' });
    expect(summary.author).toBe('A');
  });

  it('includes only shareable goals (dated and undated), dropping private ones', () => {
    const goals: Goal[] = [
      { id: 'g1', name: 'Apartment', targetAmount: 600000, currentAmount: 215000, targetDate: '2028-01-01', shareable: true },
      { id: 'g2', name: 'Emergency fund', targetAmount: 30000, currentAmount: 8000, shareable: true },
      { id: 'g3', name: 'Secret', targetAmount: 10000, currentAmount: 500, shareable: false },
    ];
    const summary = buildShareableSummary([], [], [], goals, '2026-06-04', { pairingId: 'p1' });
    expect(summary.goals).toEqual([
      { name: 'Apartment', targetAmount: 600000, currentAmount: 215000, targetDate: '2028-01-01' },
      { name: 'Emergency fund', targetAmount: 30000, currentAmount: 8000 },
    ]);
  });

  it('computes netWorth total + byBucket from shareable accounts only, mapped by type', () => {
    const accounts = [
      acct({ id: 'bank', type: 'bank', shareable: true }),
      acct({ id: 'ibi', institution: 'ibi', type: 'investment', shareable: true }),
      acct({ id: 'pension', institution: 'manual', type: 'pension', shareable: true }),
      acct({ id: 'card', institution: 'cal', type: 'credit_card', shareable: true }),
      acct({ id: 'private', type: 'bank', shareable: false }),
    ];
    const snaps = [
      snap('bank', 42200, '2026-06-01'),
      snap('ibi', 96000, '2026-05-31'),
      snap('pension', 46000, '2026-05-30'),
      snap('card', -3000, '2026-06-02'),
      snap('private', 999999, '2026-06-02'),
    ];
    const summary = buildShareableSummary(accounts, [], snaps, [], '2026-06-04', { pairingId: 'p1' });
    expect(summary.netWorth).toEqual({
      total: 42200 + 96000 + 46000 - 3000,
      byBucket: { liquid: 42200, investment: 96000, retirement: 46000, liability: -3000 },
    });
  });

  it('aggregates spending into category totals per period — shareable txns only, no line items', () => {
    const accounts = [
      acct({ id: 'shared', type: 'bank', shareable: true }),
      acct({ id: 'private', type: 'bank', shareable: false }),
    ];
    const tx = (over: Partial<Transaction>): Transaction =>
      ({ id: 't', accountId: 'shared', date: '2026-06-02', amount: -100, description: 'x', category: 'groceries', ...over });
    const txns: Transaction[] = [
      tx({ id: 't1', amount: -2600, category: 'groceries', date: '2026-06-02' }),
      tx({ id: 't2', amount: -1400, category: 'dining', date: '2026-06-03' }),
      tx({ id: 't3', accountId: 'private', amount: -5000, category: 'shopping', date: '2026-06-02' }), // private account → excluded
      tx({ id: 't4', amount: -900, category: 'dining', date: '2026-06-03', shareable: false }),         // per-tx opt-out → excluded
      tx({ id: 't5', amount: 12000, category: 'income', date: '2026-06-01' }),                           // income, not spend
    ];
    const summary = buildShareableSummary(accounts, txns, [], [], '2026-06-04', { pairingId: 'p1' });
    expect(summary.spending.thisMonth.spent).toBe(2600 + 1400);
    expect(summary.spending.thisMonth.byCategory).toEqual([
      { category: 'groceries', amount: 2600 },
      { category: 'dining', amount: 1400 },
    ]);
  });

  it('PRIVACY INVARIANT: the serialized summary leaks no raw transaction detail or private account', () => {
    const accounts = [
      acct({ id: 'shared', type: 'bank', displayName: 'Shared checking', shareable: true }),
      acct({ id: 'hidden', type: 'bank', displayName: 'Hidden account', shareable: false }),
    ];
    // both shared txns sit inside every window (<= now, same month) so every period aggregates to
    // 3737 — neither raw line amount (2637 / 1100) ever equals an aggregate, isolating leak from total.
    const txns: Transaction[] = [
      { id: 'TXSECRET1', accountId: 'shared', date: '2026-06-02', amount: -2637, description: 'SHUFERSAL-DEAL-12345', category: 'groceries' },
      { id: 'TXSECRET2', accountId: 'shared', date: '2026-06-03', amount: -1100, description: 'WOLT-ORDER-9', category: 'groceries' },
      { id: 'TXSECRET3', accountId: 'hidden', date: '2026-06-02', amount: -9999, description: 'THERAPIST-VISIT', category: 'health' },
    ];
    const snaps = [snap('shared', 42200, '2026-06-01'), snap('hidden', 5123, '2026-06-01')];

    const summary = buildShareableSummary(accounts, txns, snaps, [], '2026-06-04', { pairingId: 'p1' });
    const json = JSON.stringify(summary);

    // raw descriptions / merchants never serialize out
    for (const leak of ['SHUFERSAL', 'WOLT', 'THERAPIST', 'DEAL']) expect(json).not.toContain(leak);
    // transaction ids never serialize out
    for (const id of ['TXSECRET1', 'TXSECRET2', 'TXSECRET3']) expect(json).not.toContain(id);
    // per-transaction line amounts never serialize out (only the aggregate does)
    for (const amt of ['2637', '1100', '9999']) expect(json).not.toContain(amt);
    // the private account's identity and balance never serialize out
    expect(json).not.toContain('Hidden');
    expect(json).not.toContain('5123');

    // sanity: the AGGREGATE is present (2637 + 1100 = 3737), and the private health spend is not
    expect(summary.spending.thisMonth.byCategory).toEqual([{ category: 'groceries', amount: 3737 }]);
    expect(summary.netWorth.total).toBe(42200);
  });

  it('account privacy dominates: a shareable=true tx inside a PRIVATE account never leaks', () => {
    const accounts = [acct({ id: 'priv', type: 'bank', displayName: 'Private', shareable: false })];
    const txns: Transaction[] = [
      { id: 't1', accountId: 'priv', date: '2026-06-02', amount: -500, description: 'x', category: 'dining', shareable: true },
    ];
    const summary = buildShareableSummary(accounts, txns, [], [], '2026-06-04', { pairingId: 'p1' });
    expect(summary.accounts).toEqual([]);
    expect(summary.spending.thisMonth.spent).toBe(0);
    expect(summary.spending.thisMonth.byCategory).toEqual([]);
  });

  it('applies merchant rules and per-tx overrides to shared totals (reconciles with the dashboard)', () => {
    const accounts = [acct({ id: 'shared', type: 'bank', shareable: true })];
    const txns: Transaction[] = [
      { id: 't1', accountId: 'shared', date: '2026-06-02', amount: -300, description: 'LIME*RIDE TLV', category: 'other' },
      { id: 't2', accountId: 'shared', date: '2026-06-02', amount: -50, description: 'kiosk', category: 'dining' },
    ];
    const merchantRules = new Map<string, string>([[normalizeMerchant('LIME*RIDE TLV'), 'transport']]);
    const overrides = new Map<string, string>([['t2', 'groceries']]);
    const summary = buildShareableSummary(accounts, txns, [], [], '2026-06-04', { pairingId: 'p1', merchantRules, overrides });
    expect(summary.spending.thisMonth.byCategory).toEqual([
      { category: 'transport', amount: 300 },
      { category: 'groceries', amount: 50 },
    ]);
  });
});
