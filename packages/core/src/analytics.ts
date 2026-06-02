import type { Account, Transaction, BalanceSnapshot, CategoryCode } from './types';

export interface DashboardModel {
  generatedAt: string;
  netWorth: number;
  thisMonth: { income: number; spent: number; saved: number };
  byCategory: { category: CategoryCode | 'other'; amount: number }[];
  accounts: { id: string; name: string; institution: string; type: string; balance: number | null }[];
  recent: { date: string; amount: number; category: CategoryCode | null; rawCategory: string | null; description: string }[];
  netWorthSeries: { date: string; balance: number }[];
  goals: { name: string; current: number; target: number; targetDate: string }[];
}

const RECENT_LIMIT = 12;

function latestBalanceByAccount(snaps: BalanceSnapshot[]): Map<string, number> {
  const latestDate = new Map<string, string>(); const bal = new Map<string, number>();
  for (const s of snaps) {
    const prev = latestDate.get(s.accountId);
    if (!prev || s.date > prev) { latestDate.set(s.accountId, s.date); bal.set(s.accountId, s.balance); }
  }
  return bal;
}

export function buildDashboard(
  accounts: Account[], transactions: Transaction[], snapshots: BalanceSnapshot[], now: string,
): DashboardModel {
  const month = now.slice(0, 7);
  const inMonth = transactions.filter(t => t.date.slice(0, 7) === month);

  let income = 0, spent = 0;
  const catTotals = new Map<string, number>();
  for (const t of inMonth) {
    if (t.amount > 0) income += t.amount;
    else if (t.amount < 0) {
      spent += -t.amount;
      const c = t.category ?? 'other';
      catTotals.set(c, (catTotals.get(c) ?? 0) + -t.amount);
    }
  }
  const byCategory = [...catTotals.entries()]
    .map(([category, amount]) => ({ category: category as CategoryCode, amount }))
    .sort((a, b) => b.amount - a.amount);

  const latest = latestBalanceByAccount(snapshots);
  const netWorth = [...latest.values()].reduce((a, b) => a + b, 0);

  const byDate = new Map<string, number>();
  for (const s of snapshots) byDate.set(s.date, (byDate.get(s.date) ?? 0) + s.balance);
  const netWorthSeries = [...byDate.entries()].map(([date, balance]) => ({ date, balance }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const recent = [...transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, RECENT_LIMIT)
    .map(t => ({ date: t.date, amount: t.amount, category: t.category ?? null, rawCategory: t.rawCategory ?? null, description: t.description }));

  return {
    generatedAt: now, netWorth,
    thisMonth: { income, spent, saved: income - spent },
    byCategory,
    accounts: accounts.map(a => ({ id: a.id, name: a.displayName, institution: a.institution, type: a.type, balance: latest.has(a.id) ? latest.get(a.id)! : null })),
    recent, netWorthSeries, goals: [],
  };
}
