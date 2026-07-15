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

/** F6 monthly plan as surfaced to the dashboard — the stored plan plus the current window's sent/not-yet verdict. */
export interface PlanState { amount: number; label: string; sent: boolean }

/** F4 — ESPP in flight this plan window (Feb 1–Jul 31 / Aug 1–Jan 31), principal only — no stock quotes,
 *  no estimated value (decided; the payout cash is caught by the normal bank sync when it lands). */
export interface EsppInFlight { amount: number; windowStartMonth: string; payoutMonth: string }

/** F7 — the current pay cycle: from the latest detected salary landing to now. Null when no salary is detectable. */
export interface CycleState {
  start: string;                 // date the salary landed (cycle start, inclusive)
  payslipMonth: string | null;   // the slip funding this cycle (start month, else the month before), if entered
  income: number; spent: number; savedInvested: number;
  byCategory: { category: CategoryCode | 'other'; amount: number }[];
}

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
  leftThisMonth: number | null;    // F5 — null when not computable (no cycle, no income this month, no payslip)
  cycle: CycleState | null;        // F7 — the salary-anchored window "This month" actually means
  esppInFlight: EsppInFlight | null; // F4 — null hides the paycheck-card line (no espp in the current window)
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

/**
 * F4 — ESPP in flight: the sum of `payslips.espp` inside the plan window (fixed calendar halves, per
 * Check Point's ESPP: Feb 1–Jul 31, or Aug 1–Jan 31 spanning into the next year) that contains `now`.
 * Independent of the pay cycle / selected period — always the window around "now". Null when there's
 * nothing in flight (no payslip in the window, or all-zero espp), so the paycheck card hides the line.
 */
function esppInFlight(payslips: Payslip[], now: string): EsppInFlight | null {
  const d = new Date(now + 'T00:00:00Z');
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1; // 1-12
  const ym = (yr: number, mo: number) => `${yr}-${String(mo).padStart(2, '0')}`;
  let startMonth: string, endMonth: string, payoutMonth: string;
  if (m >= 2 && m <= 7) {
    startMonth = ym(y, 2); endMonth = ym(y, 7); payoutMonth = ym(y, 8);
  } else {
    const startYear = m === 1 ? y - 1 : y; // January belongs to the window opened the PRIOR August
    startMonth = ym(startYear, 8); endMonth = ym(startYear + 1, 1); payoutMonth = ym(startYear + 1, 2);
  }
  const amount = payslips.filter(p => p.month >= startMonth && p.month <= endMonth).reduce((s, p) => s + p.espp, 0);
  return amount > 0 ? { amount, windowStartMonth: startMonth, payoutMonth } : null;
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

  const payslips = opts.payslips ?? [];

  // F4 — ESPP in flight: always the plan window around "now", regardless of the pay cycle / selected
  // period (see esppInFlight doc comment).
  const espp = esppInFlight(payslips, now);

  // F7 — pay-cycle frame. Israeli salaries land at month-end, so calendar months answer a question
  // nobody asks. A salary event = income-category txn (effective category → re-tagging heals a false
  // hit) of at least half the bigger of {largest income txn in the last 120 days, latest payslip net}.
  // The current cycle runs from the latest salary event (whole day included) to now.
  const latestSlip = latestPayslipOf(payslips);
  const MIN_SALARY = 3000; // absolute floor: below half of Israeli minimum wage nothing is a salary anchor
  const incomeTxns = eff.filter(t => t.amount > 0 && t.category === 'income' && t.date <= now);
  const recentMax = incomeTxns.filter(t => t.date >= shiftDays(now, -120)).reduce((m, t) => Math.max(m, t.amount), 0);
  const salaryFloor = Math.max(0.5 * Math.max(recentMax, latestSlip?.net ?? 0), MIN_SALARY);
  const salaryEvents = incomeTxns.filter(t => t.amount >= salaryFloor).map(t => t.date).sort();
  const cycleStart = salaryEvents.length ? salaryEvents[salaryEvents.length - 1]! : null;

  let cycle: DashboardModel['cycle'] = null;
  if (cycleStart) {
    const s = summarize(inRange(cycleStart));
    // The slip that funded this cycle: salary paid Jun 30 or Jul 1 is June's slip — try the cycle-start
    // month first, then the month before it.
    const startYm = cycleStart.slice(0, 7);
    const prevYm = shiftDays(startYm + '-01', -1).slice(0, 7);
    const slipMonth = payslips.some(p => p.month === startYm) ? startYm
      : payslips.some(p => p.month === prevYm) ? prevYm : null;
    cycle = { start: cycleStart, payslipMonth: slipMonth, income: s.income, spent: s.spent, savedInvested: s.savedInvested, byCategory: s.byCategory };
  }

  // F6 — monthly plan sent-detection: an outgoing (amount<0) transaction inside the current window —
  // the pay cycle when one exists, else this calendar month — whose EFFECTIVE category is investment
  // or savings, covering at least 95% of the plan amount (a small bank fee or rounding shouldn't make
  // a real transfer register as "not sent").
  let plan: PlanState | null = null;
  if (opts.plan) {
    const threshold = 0.95 * opts.plan.amount;
    const inWindow = (t: Transaction) => cycleStart ? (t.date >= cycleStart && t.date <= now) : t.date.slice(0, 7) === month;
    const sent = eff.some(t =>
      inWindow(t) && t.amount < 0 &&
      (t.category === 'investment' || t.category === 'savings') &&
      Math.abs(t.amount) >= threshold
    );
    plan = { amount: opts.plan.amount, label: opts.plan.label, sent };
  }

  // F5 — "left this month": a quiet number, not a budget. With a cycle, income is REAL (the salary
  // is inside the window) — no fallback needed. Without one, incomeBase = max(calendar-month income,
  // latest payslip net) so a stray small deposit can't mask "salary hasn't landed yet".
  let leftThisMonth: number | null = null;
  const planNotYetSent = plan && !plan.sent ? plan.amount : 0;
  if (cycle) {
    leftThisMonth = cycle.income - cycle.spent - planNotYetSent;
  } else if (spending.thisMonth.income > 0 || payslips.length > 0) {
    const incomeBase = Math.max(spending.thisMonth.income, latestSlip?.net ?? 0);
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
    plan, leftThisMonth, cycle,
    esppInFlight: espp,
  };
}
