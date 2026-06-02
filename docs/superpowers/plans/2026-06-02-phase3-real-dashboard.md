# Phase 3 (MVP): Real dashboard — the approved design on your real data

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. TDD; checkbox steps.

**Goal:** Render the approved mockup design against the **real encrypted-DB data** (219 transactions, 3
accounts, balances) — net worth, this-month income/spent/saved, spending-by-category donut, recent activity.
Opens with `npm run app`; **viewing needs no bank login** (reads the local DB; DB key from keychain).

**Architecture:** Pure **analytics** in `@kesef/core` turns accounts+transactions+snapshots → a
`DashboardModel`. A tiny **app server** (`packages/ingestion/src/app.ts`) opens the Store, builds the model,
**injects it** into the dashboard HTML (`window.__KESEF__`), and serves it. The frontend
(`packages/ingestion/web/dashboard.html`) is the mockup with its hardcoded sample data swapped for
`window.__KESEF__`, design preserved, with empty-states for what we don't have yet (goals, sparse trend,
partner/couple).

**Reuses:** the approved mockup (`mockups/index.html`) for design; `Store` (add one read method); keychain
DB key (`getDbKey`); the static-serve pattern.

**Honest scope:** with current data the donut/recent/this-month are rich (219 categorized txns); net-worth =
sum of latest balance snapshots (mostly the Beinleumi balance until IBI/pension are added via `add-balance`);
the net-worth **trend** is sparse (one snapshot so far — fills in as you sync); **goals** show an empty-state
(no goal storage yet); **Partner/Couple** views are disabled (Phase 4). All degrade gracefully.

---

## Task 1: `Store.allBalanceSnapshots()` + `@kesef/core` analytics — TDD

**Files:** modify `packages/core/src/store.ts`; create `packages/core/src/analytics.ts`; export from `index.ts`; create `packages/core/test/analytics.test.ts` (+ a store-sync assertion).

- [ ] **Step 1: Failing test** — `packages/core/test/analytics.test.ts`:
```ts
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
  it('net worth = sum of latest balance per account', () => {
    expect(d.netWorth).toBe(1200); // latest beinleumi snapshot; cal has none
  });
  it('this-month income/spent/saved (June)', () => {
    expect(d.thisMonth.income).toBe(9000);
    expect(d.thisMonth.spent).toBe(200);   // 100+40+60, excludes May's 500
    expect(d.thisMonth.saved).toBe(8800);
  });
  it('spending by category this month, sorted desc, magnitudes', () => {
    expect(d.byCategory[0]).toEqual({ category: 'dining', amount: 160 });
    expect(d.byCategory.find(c => c.category === 'groceries')!.amount).toBe(40);
    expect(d.byCategory.some(c => c.category === 'shopping')).toBe(false); // May excluded
  });
  it('recent is newest-first and capped', () => {
    expect(d.recent[0]!.description).toBe('תן ביס'); // 2026-06-05 newest
    expect(d.recent.length).toBeLessThanOrEqual(12);
  });
  it('net-worth series is one total per date, ascending', () => {
    expect(d.netWorthSeries).toEqual([
      { date: '2026-05-01', balance: 1000 }, { date: '2026-06-01', balance: 1200 },
    ]);
  });
  it('no goals yet', () => { expect(d.goals).toEqual([]); });
});
```

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement** — `packages/core/src/analytics.ts`:
```ts
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
  const month = now.slice(0, 7); // YYYY-MM
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
  const netWorthSeries = [...byDate.entries()].map(([date, balance]) => ({ date, balance })).sort((a, b) => a.date.localeCompare(b.date));

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
```
Add `Store.allBalanceSnapshots()` to `packages/core/src/store.ts` (beside `allTransactions`):
```ts
  allBalanceSnapshots(): BalanceSnapshot[] {
    return (this.db.prepare('SELECT * FROM balance_snapshots ORDER BY date, id').all() as Record<string, unknown>[])
      .map(r => ({ id: r['id'] as string, accountId: r['account_id'] as string, date: r['date'] as string, balance: r['balance'] as number }));
  }
```
Export analytics from `index.ts`: `export * from './analytics';`

- [ ] **Step 4: Run → passes** (`npm test`); `npm run typecheck` clean. Do NOT commit.

---

## Task 2: Dashboard frontend (adapt the approved mockup to real data)

**Files:** create `packages/ingestion/web/dashboard.html` (copied from `mockups/index.html`, then rewired).

- [ ] **Step 1:** Copy `mockups/index.html` → `packages/ingestion/web/dashboard.html`. **Preserve ALL CSS/markup/animation/the He-En + dark/light toggles exactly** — this is the approved design.

- [ ] **Step 2:** Replace the hardcoded data with the injected real model. The server will inject a line
`window.__KESEF__ = {...DashboardModel...};` (and a `window.__KESEF_LANG__`). In the `<script>`:
  - Delete the sample `DATA`, `accounts`, `goals`, `txns` constants.
  - Read `const M = window.__KESEF__;`
  - **Hero net worth** ← `M.netWorth`; **delta chip** ← computed from `M.netWorthSeries` (first vs last); if `<2` points, hide the delta.
  - **Net-worth chart** ← `M.netWorthSeries` balances; if `<2` points, show a friendly "trend builds as you sync" note instead of the sparkline.
  - **Stat strip** ← `M.thisMonth` (income/spent/saved); savings-rate pill = `saved/income`.
  - **Spending donut + legend** ← `M.byCategory` (top categories, with the existing category colors; map any `CategoryCode` to a color, default grey). Donut total = sum of `byCategory`.
  - **Recent** ← `M.recent` (date · amount · category · `[rawCategory]` if present · description), using the existing row styling and category icons (fallback icon for unknown).
  - **Goals card** ← `M.goals`; when empty, show a friendly empty-state ("No goals yet — add one with `npm run add-goal` (coming soon)") instead of rings.
  - **Forecast card** ← if `M.netWorthSeries.length < 2`, show "needs a bit more history" placeholder; else a simple linear projection.
  - **Me / Partner / Couple toggle**: keep "Me" (real data); render Partner & Couple as **disabled** with a small "arrives with couple-sync (Phase 4)" hint.
  - Keep the **He/En** + **theme** toggles working (frontend-only).
  - Category labels: keep the existing he/en `T.cat` map; for any category code not in it, show the code.

- [ ] **Step 3:** No build step; this is static HTML served by the app server (Task 3). Just ensure it has a clear placeholder the server replaces, e.g. a `<script>window.__KESEF__ = /*__KESEF_DATA__*/ null;</script>` line near the top of the page script.

> No unit tests for the HTML; it's verified by running `npm run app` (Task 3) and viewing real numbers.

---

## Task 3: App server — `npm run app`

**Files:** create `packages/ingestion/src/app.ts`; modify root `package.json`.

- [ ] **Step 1:** `packages/ingestion/src/app.ts`:
```ts
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { KeyringVault, Store, buildDashboard } from '@kesef/core';
import { dbPath } from './paths.js';

const vault = new KeyringVault('kesef');
const webDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const port = Number(process.env.PORT) || 8750;

async function getDbKey(): Promise<string> {
  const k = await vault.get('db-key');
  if (!k) throw new Error('No data yet — run `npm run connect` then `npm run sync` first.');
  return k;
}

function buildModel(key: string) {
  const store = Store.open({ path: dbPath(), key });
  try {
    return buildDashboard(store.allAccounts?.() ?? store.listAccounts(), store.allTransactions(), store.allBalanceSnapshots(), new Date().toISOString().slice(0, 10));
  } finally { store.close(); }
}

createServer(async (req, res) => {
  try {
    if ((req.url || '/').split('?')[0] !== '/') { res.writeHead(404); return res.end('not found'); }
    const key = await getDbKey();
    const model = buildModel(key);
    const html = readFileSync(join(webDir, 'dashboard.html'), 'utf8')
      .replace('/*__KESEF_DATA__*/ null', JSON.stringify(model));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(e instanceof Error ? e.message : 'error');
  }
}).listen(port, () => console.log(`kesef dashboard → http://localhost:${port}  (Ctrl-C to stop)`));
```
(`randomBytes` import only if needed; `store.listAccounts()` already exists — use it; drop the `allAccounts?.()` fallback and just call `store.listAccounts()`.)

- [ ] **Step 2:** root `package.json` scripts: add `"app": "tsx packages/ingestion/src/app.ts"`.

- [ ] **Step 3: Verify** — `npm run typecheck` clean; `npm test` green. Then **run it**: `npm run app`, open `http://localhost:8750`, confirm real numbers (your categories, recent merchants, this-month totals) render in the approved design. If the DB key is unavailable in the agent's context, report that and leave the user to run it.

---

## Verification (end of Phase 3 MVP)
- `npm test` green (analytics + all prior); `npm run typecheck` clean.
- `npm run app` → the approved dashboard shows **real** data: net worth, this-month income/spent/saved, the spending donut from real categories, real recent merchants. Empty-states for goals/forecast/partner are graceful.
- Viewing requires **no bank login** (local DB only).

## Out of scope / next
- **Interactive browser-only login** (the user's other request) → next, after this.
- Goal entry (`add-goal`), forecasting with more history, Partner/Couple (Phase 4 couple-sync), per-tx category override UI.
