import type { Account, Transaction, BalanceSnapshot, CategoryCode, Goal, Payslip, Horizon, HorizonTotals, MonthlyPlan } from './types';
import { horizonSplit } from './types';
import { normalizeMerchant } from './merchant';

export interface PeriodSummary {
  income: number; spent: number; saved: number; savedInvested: number;
  byCategory: { category: CategoryCode | 'other'; amount: number }[];
}

export interface ClientTxn {
  id: string; accountId: string; date: string; amount: number;
  description: string; merchant: string;
  category: CategoryCode | null; rawCategory: string | null;
}

/** Couple pairing state surfaced to the dashboard (non-secret; drives the partner/couple view toggle). */
export interface CoupleViewState {
  paired: boolean;
  role?: 'A' | 'B';
  partnerLabel?: string | null;
  relayUrl?: string | null;
  partnerAsOf?: string | null;
}

/** F6 monthly plan as surfaced to the dashboard — the stored plan plus this month's sent/not-yet verdict. */
export interface PlanState { amount: number; label: string; sentThisMonth: boolean }

export interface DashboardModel {
  generatedAt: string;
  netWorth: number;
  spending: { thisMonth: PeriodSummary; last30: PeriodSummary; last90: PeriodSummary; year: PeriodSummary };
  composition: HorizonTotals; // net worth split by horizon (daily/medium/long) — drives the composition tiles
  accounts: { id: string; name: string; institution: string; type: string; balance: number | null; asOf: string | null; shareable: boolean; horizon: Horizon | null; components: { name: string; value: number; horizon?: Horizon }[] | null; history: { date: string; balance: number }[] }[];
  recent: { id: string; date: string; amount: number; category: CategoryCode | null; rawCategory: string | null; description: string; merchant: string }[];
  netWorthSeries: { date: string; balance: number }[];
  goals: Goal[];
  transactions: ClientTxn[];
  payslips: Payslip[];
  couple: CoupleViewState;
  plan: PlanState | null;          // F6 — null when no plan is set
  leftThisMonth: number | null;    // F5 — null when not computable (no income this month AND no payslip to fall back on)
}

const RECENT_LIMIT = 12;
const NON_SPEND = new Set<string>(['transfer', 'savings', 'investment']);

/** Per-account balance history (snapshots over time), ascending by date — for per-account trend graphs. */
function historyByAccount(snaps: BalanceSnapshot[]): Map<string, { date: string; balance: number }[]> {
  const m = new Map<string, { date: string; balance: number }[]>();
  for (const s of [...snaps].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!m.has(s.accountId)) m.set(s.accountId, []);
    m.get(s.accountId)!.push({ date: s.date, balance: s.balance });
  }
  return m;
}

function latestBalanceByAccount(snaps: BalanceSnapshot[]): { bal: Map<string, number>; asOf: Map<string, string> } {
  const asOf = new Map<string, string>(); const bal = new Map<string, number>();
  for (const s of snaps) {
    const prev = asOf.get(s.accountId);
    if (!prev || s.date > prev) { asOf.set(s.accountId, s.date); bal.set(s.accountId, s.balance); }
  }
  return { bal, asOf };
}

/** The most recent payslip by month (YYYY-MM sorts lexicographically), or null if there are none. */
function latestPayslipOf(payslips: Payslip[]): Payslip | null {
  return payslips.reduce<Payslip | null>((latest, p) => (!latest || p.month > latest.month) ? p : latest, null);
}

export function summarize(txns: Transaction[]): PeriodSummary {
  let income = 0, spent = 0, savedInvested = 0;
  const cat = new Map<string, number>();
  for (const t of txns) {
    if (t.amount > 0) { income += t.amount; continue; }
    if (t.amount >= 0) continue;
    const mag = -t.amount; const c = t.category ?? 'other';
    if (c === 'savings' || c === 'investment') savedInvested += mag;     // your money kept — not spent
    else if (c === 'transfer') { /* internal move — neither spent nor saved */ }
    else { spent += mag; cat.set(c, (cat.get(c) ?? 0) + mag); }
  }
  const byCategory = [...cat.entries()].map(([category, amount]) => ({ category: category as CategoryCode, amount })).sort((a, b) => b.amount - a.amount);
  return { income, spent, saved: income - spent, savedInvested, byCategory };
}

/**
 * Reconstruct net worth over time. The bank only ever reports the CURRENT balance, so we walk backward
 * from it through each account's transactions to recover the historical balance at every transaction date.
 * Accounts without a known current balance are excluded. Accounts with no transactions (manual/IBI/MVS
 * pension-style balances) use their snapshot series as checkpoints — so hand-entered history moves the
 * long-run curve; only a single-snapshot account stays flat.
 */
function reconstructNetWorthSeries(
  transactions: Transaction[],
  latest: Map<string, number>,
  now: string,
  snapHistory: Map<string, { date: string; balance: number }[]>,
): { date: string; balance: number }[] {
  interface Acct { dates: string[]; bals: number[]; startBal: number; flat: number | null }
  const perAccount: Acct[] = [];
  for (const [id, current] of latest) {
    const txns = transactions.filter(t => t.accountId === id && t.date <= now).sort((a, b) => a.date.localeCompare(b.date));
    if (txns.length === 0) {
      const hist = (snapHistory.get(id) ?? []).filter(h => h.date <= now);
      if (hist.length === 0) { perAccount.push({ dates: [], bals: [], startBal: current, flat: current }); continue; }
      perAccount.push({ dates: hist.map(h => h.date), bals: hist.map(h => h.balance), startBal: hist[0]!.balance, flat: null });
      continue;
    }
    const sumAll = txns.reduce((s, t) => s + t.amount, 0);
    const startBal = current - sumAll;                 // balance just before the first transaction
    const dateToBal = new Map<string, number>();
    let running = startBal;
    for (const t of txns) { running += t.amount; dateToBal.set(t.date, running); } // end-of-date balance
    const dates = [...dateToBal.keys()].sort();
    perAccount.push({ dates, bals: dates.map(d => dateToBal.get(d)!), startBal, flat: null });
  }
  const allDates = new Set<string>([now]);
  for (const a of perAccount) for (const d of a.dates) allDates.add(d);
  return [...allDates].sort().map(d => {
    let total = 0;
    for (const a of perAccount) {
      if (a.flat !== null) { total += a.flat; continue; }      // no transactions → constant
      if (d < a.dates[0]!) { total += a.startBal; continue; }  // before this account's first txn
      let i = a.dates.length - 1;
      while (i > 0 && a.dates[i]! > d) i--;                     // latest checkpoint ≤ d
      total += a.bals[i]!;
    }
    return { date: d, balance: total };
  });
}

export function shiftDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}

export function buildDashboard(
  accounts: Account[], transactions: Transaction[], snapshots: BalanceSnapshot[], now: string,
  opts: { goals?: Goal[]; overrides?: Map<string, string>; merchantRules?: Map<string, string>; couple?: CoupleViewState; payslips?: Payslip[]; plan?: MonthlyPlan | null } = {},
): DashboardModel {
  const overrides = opts.overrides ?? new Map<string, string>();
  const merchantRules = opts.merchantRules ?? new Map<string, string>();
  // Effective category precedence: per-transaction override → merchant rule → auto-assigned.
  // The merchant rule keys off normalizeMerchant(description), so it also catches future syncs.
  const eff = transactions.map(t => {
    const byTxn = overrides.get(t.id) as CategoryCode | undefined;
    const byMerchant = merchantRules.get(normalizeMerchant(t.description)) as CategoryCode | undefined;
    return { ...t, category: byTxn ?? byMerchant ?? t.category };
  });

  const month = now.slice(0, 7);
  const inRange = (from: string) => eff.filter(t => t.date >= from && t.date <= now);
  const spending = {
    thisMonth: summarize(eff.filter(t => t.date.slice(0, 7) === month)),
    last30: summarize(inRange(shiftDays(now, -30))),
    last90: summarize(inRange(shiftDays(now, -90))),
    year: summarize(inRange(shiftDays(now, -365))),
  };

  // F6 — monthly plan sent-detection: an outgoing (amount<0) transaction THIS calendar month whose
  // EFFECTIVE category (same override→merchant-rule→auto resolution as `eff` above, not the raw
  // category) is investment or savings, covering at least 95% of the plan amount (a small bank fee
  // or rounding shouldn't make a real transfer register as "not sent").
  let plan: PlanState | null = null;
  if (opts.plan) {
    const threshold = 0.95 * opts.plan.amount;
    const sentThisMonth = eff.some(t =>
      t.date.slice(0, 7) === month && t.amount < 0 &&
      (t.category === 'investment' || t.category === 'savings') &&
      Math.abs(t.amount) >= threshold
    );
    plan = { amount: opts.plan.amount, label: opts.plan.label, sentThisMonth };
  }

  // F5 — "left this month": a quiet number, not a budget. incomeBase = max(bank income this month,
  // latest payslip net) — a stray small deposit must not mask the "salary hasn't landed yet" case,
  // and once the real salary lands it exceeds the payslip net and wins. Null when neither exists.
  const payslips = opts.payslips ?? [];
  let leftThisMonth: number | null = null;
  if (spending.thisMonth.income > 0 || payslips.length > 0) {
    const incomeBase = Math.max(spending.thisMonth.income, latestPayslipOf(payslips)?.net ?? 0);
    const planNotYetSent = plan && !plan.sentThisMonth ? plan.amount : 0;
    leftThisMonth = incomeBase - spending.thisMonth.spent - planNotYetSent;
  }

  const { bal: latest, asOf } = latestBalanceByAccount(snapshots);
  const histByAccount = historyByAccount(snapshots);
  const netWorth = [...latest.values()].reduce((a, b) => a + b, 0);

  // Composition: every account's balance split across horizons (type default, account override,
  // or component tag — see resolveHorizon), summed into the three tiles the dashboard shows.
  const composition: HorizonTotals = { daily: 0, medium: 0, long: 0 };
  for (const a of accounts) {
    const bal = latest.get(a.id);
    if (bal == null) continue;
    const split = horizonSplit(a, bal);
    composition.daily += split.daily; composition.medium += split.medium; composition.long += split.long;
  }

  // Net-worth trend: reconstruct from transactions when we have them (true history back to the first txn);
  // otherwise fall back to whatever balance snapshots exist.
  let netWorthSeries: { date: string; balance: number }[];
  if (transactions.length && latest.size) {
    netWorthSeries = reconstructNetWorthSeries(transactions, latest, now, histByAccount);
  } else {
    const byDate = new Map<string, number>();
    for (const s of snapshots) byDate.set(s.date, (byDate.get(s.date) ?? 0) + s.balance);
    netWorthSeries = [...byDate.entries()].map(([date, balance]) => ({ date, balance })).sort((a, b) => a.date.localeCompare(b.date));
  }

  const recent = [...eff].sort((a, b) => b.date.localeCompare(a.date)).slice(0, RECENT_LIMIT)
    .map(t => ({ id: t.id, date: t.date, amount: t.amount, category: t.category ?? null, rawCategory: t.rawCategory ?? null, description: t.description, merchant: normalizeMerchant(t.description) }));

  const txList: ClientTxn[] = [...eff]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((t, _i) => {
      const orig = transactions.find(o => o.id === t.id);
      return {
        id: t.id, accountId: t.accountId, date: t.date, amount: t.amount,
        description: t.description, merchant: normalizeMerchant(t.description),
        category: t.category ?? null, rawCategory: (orig?.rawCategory) ?? null,
      };
    });

  return {
    generatedAt: now, netWorth,
    spending, composition,
    accounts: accounts.map(a => ({ id: a.id, name: a.displayName, institution: a.institution, type: a.type, balance: latest.has(a.id) ? latest.get(a.id)! : null, asOf: asOf.get(a.id) ?? null, shareable: a.shareable, horizon: a.horizon ?? null, components: a.components ?? null, history: histByAccount.get(a.id) ?? [] })),
    recent, netWorthSeries, goals: opts.goals ?? [],
    transactions: txList,
    payslips,
    couple: opts.couple ?? { paired: false },
    plan, leftThisMonth,
  };
}
