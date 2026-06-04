import { describe, it, expect } from 'vitest';
import { buildDashboard } from '../src/analytics';
import type { Account, Transaction, BalanceSnapshot } from '../src/index';

const accounts: Account[] = [
  { id: 'beinleumi:1', institution: 'beinleumi', type: 'bank', displayName: 'עו"ש', currency: 'ILS', shareable: false },
  { id: 'cal:1', institution: 'cal', type: 'credit_card', displayName: 'Cal', currency: 'ILS', shareable: false },
];
const snaps: BalanceSnapshot[] = [
  { id: 'beinleumi:1@2026-05-01', accountId: 'beinleumi:1', date: '2026-05-01', balance: 1000 },
  { id: 'beinleumi:1@2026-06-01', accountId: 'beinleumi:1', date: '2026-06-01', balance: 1200 },
];
const txns: Transaction[] = [
  { id: 't1', accountId: 'cal:1', date: '2026-06-03', amount: -100, description: 'WOLT', category: 'dining', shareable: false },
  { id: 't2', accountId: 'cal:1', date: '2026-06-04', amount: -40,  description: 'שופרסל', category: 'groceries', shareable: false },
  { id: 't3', accountId: 'cal:1', date: '2026-06-05', amount: -60,  description: 'תן ביס', category: 'dining', shareable: false },
  { id: 't4', accountId: 'beinleumi:1', date: '2026-06-02', amount: 9000, description: 'salary', category: 'income', shareable: false },
  { id: 't5', accountId: 'cal:1', date: '2026-05-20', amount: -500, description: 'old month', category: 'shopping', shareable: false },
];

describe('buildDashboard', () => {
  const d = buildDashboard(accounts, txns, snaps, '2026-06-15');
  it('net worth = sum of latest balance per account', () => { expect(d.netWorth).toBe(1200); });
  it('this-month spending (June)', () => {
    expect(d.spending.thisMonth.income).toBe(9000);
    expect(d.spending.thisMonth.spent).toBe(200);     // 100+40+60; excludes May
    expect(d.spending.thisMonth.saved).toBe(8800);
    expect(d.spending.thisMonth.byCategory[0]).toEqual({ category: 'dining', amount: 160 });
    expect(d.spending.thisMonth.byCategory.some(c => c.category === 'shopping')).toBe(false);
  });
  it('last-30-days spending includes the late-May shopping txn', () => {
    expect(d.spending.last30.spent).toBe(700);         // 200 + the May-20 ₪500 shopping (within 30d of Jun-15)
    expect(d.spending.last30.byCategory.find(c => c.category === 'shopping')!.amount).toBe(500);
  });
  it('last-90-days and year include everything here', () => {
    expect(d.spending.last90.spent).toBe(700);
    expect(d.spending.year.spent).toBe(700);
  });
  it('recent is newest-first and capped at 12', () => {
    expect(d.recent[0]!.description).toBe('תן ביס');
    expect(d.recent.length).toBeLessThanOrEqual(12);
  });
  it('net-worth series is one total per date, ascending (reconstructed from txns)', () => {
    // beinleumi:1 balance 1200, salary +9000 on 06-02 → startBal -7800; ends at 1200 today
    expect(d.netWorthSeries).toEqual([{ date: '2026-06-02', balance: 1200 }, { date: '2026-06-15', balance: 1200 }]);
  });
  it('no goals when none passed', () => { expect(d.goals).toEqual([]); });
  it('includes the full transaction list with normalized merchant', () => {
    expect(d.transactions.length).toBe(5);
    // every txn has a non-empty merchant string
    expect(d.transactions.every(t => typeof t.merchant === 'string' && t.merchant.length > 0)).toBe(true);
    // WOLT normalizes to 'Wolt'
    const wolt = d.transactions.find(t => t.description === 'WOLT');
    expect(wolt?.merchant).toBe('Wolt');
    // שופרסל normalizes to 'שופרסל'
    const shufersal = d.transactions.find(t => t.description === 'שופרסל');
    expect(shufersal?.merchant).toBe('שופרסל');
    // newest first: t3 (2026-06-05) should be first
    expect(d.transactions[0]!.date >= d.transactions[d.transactions.length - 1]!.date).toBe(true);
    expect(d.transactions[0]!.date).toBe('2026-06-05');
  });
  it('savings/investment outflows are NOT counted as spent', () => {
    const txns2 = [
      { id: 'x1', accountId: 'a', date: '2026-06-10', amount: -15000, description: 'העברה מהחשבון', category: 'investment', shareable: false },
      { id: 'x2', accountId: 'a', date: '2026-06-11', amount: -50, description: 'cafe', category: 'dining', shareable: false },
    ] as any;
    const d2 = buildDashboard([], txns2, [], '2026-06-15');
    expect(d2.spending.thisMonth.spent).toBe(50);             // investment excluded
    expect(d2.spending.thisMonth.savedInvested).toBe(15000);  // counted here instead
    expect(d2.spending.thisMonth.byCategory.some(c => c.category === 'investment')).toBe(false);
  });
  it('per-transaction override changes effective category', () => {
    const txns3 = [{ id: 'z1', accountId: 'a', date: '2026-06-10', amount: -15000, description: 'העברה מהחשבון', category: 'transfer', shareable: false }] as any;
    const d3 = buildDashboard([], txns3, [], '2026-06-15', { overrides: new Map([['z1', 'investment']]) });
    expect(d3.spending.thisMonth.savedInvested).toBe(15000);  // override made it investment
    expect(d3.transactions[0]!.category).toBe('investment');
  });
  it('returns goals passed in opts', () => {
    const g = { id: 'g', name: 'x', targetAmount: 1, targetDate: '2027-01-01', currentAmount: 0, shareable: false };
    expect(buildDashboard([], [], [], '2026-06-15', { goals: [g] }).goals).toEqual([g]);
  });
  it('a merchant rule recategorizes EVERY matching transaction (learning sticks)', () => {
    const lime = [
      { id: 'l1', accountId: 'a', date: '2026-06-10', amount: -15, description: 'LIME*5 RIDES 3VJJ +18885463345 US', category: 'transport', shareable: false },
      { id: 'l2', accountId: 'a', date: '2026-06-11', amount: -12, description: 'LIME*RIDE 3VJJ', category: 'transport', shareable: false },
    ] as any;
    const d = buildDashboard([], lime, [], '2026-06-15', { merchantRules: new Map([['Lime', 'fees']]) });
    expect(d.transactions.map(t => t.category)).toEqual(['fees', 'fees']);  // both Lime → fees
  });
  it('reconstructs the net-worth series backward from current balance + transactions', () => {
    const accts = [{ id: 'beinleumi:1', institution: 'beinleumi', type: 'bank', displayName: 'b', currency: 'ILS', shareable: false }] as any;
    const txns2 = [
      { id: 'n1', accountId: 'beinleumi:1', date: '2025-11-10', amount: 10000, description: 'salary', shareable: false },
      { id: 'n2', accountId: 'beinleumi:1', date: '2025-12-10', amount: -3000, description: 'rent', shareable: false },
    ] as any;
    const snaps2 = [{ id: 'beinleumi:1@2026-06-03', accountId: 'beinleumi:1', date: '2026-06-03', balance: 7000 }] as any;
    const d = buildDashboard(accts, txns2, snaps2, '2026-06-03');
    expect(d.netWorth).toBe(7000);
    const s = d.netWorthSeries;                       // current 7000, sumAll 7000 → startBal 0
    expect(s[0]).toEqual({ date: '2025-11-10', balance: 10000 });          // after salary
    expect(s.find(p => p.date === '2025-12-10')!.balance).toBe(7000);      // after rent
    expect(s[s.length - 1]!.balance).toBe(7000);                           // ends at today's balance
  });
  it('per-transaction override beats a merchant rule', () => {
    const lime = [{ id: 'l1', accountId: 'a', date: '2026-06-10', amount: -15, description: 'LIME*5 RIDES', category: 'transport', shareable: false }] as any;
    const d = buildDashboard([], lime, [], '2026-06-15', {
      merchantRules: new Map([['Lime', 'fees']]),
      overrides: new Map([['l1', 'health']]),
    });
    expect(d.transactions[0]!.category).toBe('health');  // per-txn override wins
  });
});
