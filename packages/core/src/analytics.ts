import type { Account, Transaction, BalanceSnapshot, CategoryCode } from './types';
import { normalizeMerchant } from './merchant';

export interface PeriodSummary {
  income: number; spent: number; saved: number;
  byCategory: { category: CategoryCode | 'other'; amount: number }[];
}

export interface ClientTxn {
  id: string; accountId: string; date: string; amount: number;
  description: string; merchant: string;
  category: CategoryCode | null; rawCategory: string | null;
}

export interface DashboardModel {
  generatedAt: string;
  netWorth: number;
  spending: { thisMonth: PeriodSummary; last30: PeriodSummary; last90: PeriodSummary; year: PeriodSummary };
  accounts: { id: string; name: string; institution: string; type: string; balance: number | null }[];
  recent: { date: string; amount: number; category: CategoryCode | null; rawCategory: string | null; description: string }[];
  netWorthSeries: { date: string; balance: number }[];
  goals: { name: string; current: number; target: number; targetDate: string }[];
  transactions: ClientTxn[];
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

function summarize(txns: Transaction[]): PeriodSummary {
  let income = 0, spent = 0;
  const cat = new Map<string, number>();
  for (const t of txns) {
    if (t.amount > 0) income += t.amount;
    else if (t.amount < 0) { spent += -t.amount; const c = t.category ?? 'other'; cat.set(c, (cat.get(c) ?? 0) + -t.amount); }
  }
  const byCategory = [...cat.entries()].map(([category, amount]) => ({ category: category as CategoryCode, amount })).sort((a, b) => b.amount - a.amount);
  return { income, spent, saved: income - spent, byCategory };
}

function shiftDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}

export function buildDashboard(
  accounts: Account[], transactions: Transaction[], snapshots: BalanceSnapshot[], now: string,
): DashboardModel {
  const month = now.slice(0, 7);
  const inRange = (from: string) => transactions.filter(t => t.date >= from && t.date <= now);
  const spending = {
    thisMonth: summarize(transactions.filter(t => t.date.slice(0, 7) === month)),
    last30: summarize(inRange(shiftDays(now, -30))),
    last90: summarize(inRange(shiftDays(now, -90))),
    year: summarize(inRange(shiftDays(now, -365))),
  };

  const latest = latestBalanceByAccount(snapshots);
  const netWorth = [...latest.values()].reduce((a, b) => a + b, 0);

  const byDate = new Map<string, number>();
  for (const s of snapshots) byDate.set(s.date, (byDate.get(s.date) ?? 0) + s.balance);
  const netWorthSeries = [...byDate.entries()].map(([date, balance]) => ({ date, balance }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const recent = [...transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, RECENT_LIMIT)
    .map(t => ({ date: t.date, amount: t.amount, category: t.category ?? null, rawCategory: t.rawCategory ?? null, description: t.description }));

  const txList: ClientTxn[] = [...transactions]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(t => ({
      id: t.id, accountId: t.accountId, date: t.date, amount: t.amount,
      description: t.description, merchant: normalizeMerchant(t.description),
      category: t.category ?? null, rawCategory: t.rawCategory ?? null,
    }));

  return {
    generatedAt: now, netWorth,
    spending,
    accounts: accounts.map(a => ({ id: a.id, name: a.displayName, institution: a.institution, type: a.type, balance: latest.has(a.id) ? latest.get(a.id)! : null })),
    recent, netWorthSeries, goals: [],
    transactions: txList,
  };
}
