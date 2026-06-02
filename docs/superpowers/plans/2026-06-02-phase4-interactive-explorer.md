# Phase 4: Interactive spending explorer + goals

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. TDD where logic is pure.

**Goal:** Turn the static dashboard into something you can *explore* — answering the user's feedback:
click any category/merchant to drill into the real transactions, view-all, see transfers, **bundle
recurring merchants** (Lime · ₪/mo), replace coarse "shopping" with the **card's specific label**
(fashion/furniture/electronics), and **add + track savings goals**.

**Architecture shift:** the app server stops sending only pre-aggregated numbers and instead injects the
**full categorized transaction list** (+ a normalized `merchant` + the card's `rawCategory`) plus accounts,
net-worth series, and goals. The page becomes a small **client-side app** that filters by period, groups by
category / sub-category / merchant, drills into transaction lists, and shows a transfers view — all locally,
no network. Goals get **persistent storage** (the `goals` table already exists) + an in-app add (server POST).

**Sequence (check in between pieces):**
- **Piece 1 — data foundation** (backend, TDD): `normalizeMerchant`, `buildClientPayload`, app injects it. → then the interactive frontend.
- **Piece 2 — interactive frontend**: period + category drill-down (bucket → card sub-category → merchant → txns), merchant-bundling view, transfers view, view-all. Preserve the approved design.
- **Piece 3 — goals**: Store goal CRUD + `add-goal` CLI + server POST + in-app add/track.

---

## Piece 1 — data foundation

### Task 1a: `normalizeMerchant` (ingestion) — TDD
Collapse noisy descriptions to a stable merchant name so recurring spend bundles.
- `packages/ingestion/src/merchant.ts` + test.
- Examples to pass: `LIME*5 RIDES 3VJJ +18885463345 US` → `Lime`; `LIME*RIDE 3VJJ` → `Lime`;
  `WOLT` / `Wolt` → `Wolt`; `Spotify P42E041985` → `Spotify`; `ג'ינג'ז מרקט קרליבך-צמרת` → `ג'ינג'ז מרקט`;
  `שופרסל דיל` → `שופרסל`.
- Approach: an alias table of `[RegExp, canonicalName]` for known recurring merchants (Lime, Wolt, Spotify,
  Netflix, Paz, Shufersal/שופרסל, Rami Levy/רמי לוי, PayBox/פייבוקס, Cafe chains…), checked first; else a
  fallback: take the text before `*`, strip trailing phone/number/country tokens and `בע"מ`, collapse spaces.

### Task 1b: `buildClientPayload` (core) — TDD + app injection
- `packages/core/src/analytics.ts`: add
```ts
export interface ClientTxn { id: string; accountId: string; date: string; amount: number; description: string; merchant: string; category: CategoryCode | null; rawCategory: string | null; }
export interface ClientPayload {
  generatedAt: string; netWorth: number;
  netWorthSeries: { date: string; balance: number }[];
  accounts: { id: string; name: string; institution: string; type: string; balance: number | null }[];
  goals: Goal[];
  transactions: ClientTxn[];
}
export function buildClientPayload(accounts, transactions, snapshots, goals, now, normalize): ClientPayload
```
  (reuse `latestBalanceByAccount`; `merchant = normalize(description)`; pass `normalizeMerchant` in from the
  app to avoid a core→ingestion dep). Keep `buildDashboard` for now (back-compat) or have the app use the
  payload directly.
- `packages/ingestion/src/app.ts`: build the payload (`buildClientPayload(..., normalizeMerchant)` + `listGoals`)
  and inject it as `window.__KESEF__`. (Goals list needs Store.listGoals — add in Piece 3; until then inject `[]`.)

**Verify:** `npm test` + `npm run typecheck`; `npm run app` serves a payload containing `transactions[]` with
`merchant` set. CHECK IN with the user before the frontend rebuild.

---

## Piece 2 — interactive frontend (`packages/ingestion/web/dashboard.html`)
Rebuild the script to drive an interactive app off `window.__KESEF__` (the `ClientPayload`). Preserve ALL CSS.
- **Period switch** (have it) filters `transactions` client-side.
- **Spending donut/legend** by **bucket**; clicking a bucket opens a drill panel: its **card sub-categories**
  (`rawCategory`, e.g. אופנה/ריהוט) and **merchants**, each expandable to the actual transactions.
- **Merchants view**: group the period's spend by `merchant`, sorted desc — "Lime · ₪71", "Wolt · ₪480" — each
  click → that merchant's transactions.
- **Transfers view/toggle**: show `category === 'transfer'` separately, and a toggle for whether transfers
  count toward "spent".
- **Recent → View all**: working; opens the full filtered list (searchable).
- **Finer label**: where a transaction has `rawCategory`, surface it (so "shopping" reads as fashion/furniture).
- Keep He/En + light/dark.

---

## Piece 3 — goals
- `packages/core/src/store.ts`: `upsertGoal(Goal)`, `listGoals(): Goal[]`, `deleteGoal(id)` (table exists). TDD.
- CLI `add-goal` (name, target ₪, target date) and `goals` (list); app injects `listGoals()` into the payload.
- App server: `POST /api/goals` (add) + `DELETE /api/goals/:id`; in-app "add goal" form posts to it.
- Frontend goals card: progress rings + "save ₪X/month to hit it by <date>"; add/edit/remove.

## Out of scope / later
- Per-transaction manual category override UI; Leumi as a 3rd source; forecasting with more history; couple sync (separate phase).
