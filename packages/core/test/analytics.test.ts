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
  it('net-worth series is one total per date, ascending', () => {
    expect(d.netWorthSeries).toEqual([{ date: '2026-05-01', balance: 1000 }, { date: '2026-06-01', balance: 1200 }]);
  });
  it('no goals yet', () => { expect(d.goals).toEqual([]); });
});
