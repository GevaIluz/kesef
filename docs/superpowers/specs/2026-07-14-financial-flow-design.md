# kesef — Financial-Flow Design (Guy + Amiti interview, 2026-07-14)

## Why this spec exists

Interview answers that shape everything below:

| Question | Answer | Design consequence |
|---|---|---|
| How do you run money as a couple? | Separate accounts, shared costs split informally | Couple view stays **aggregation**; no who-paid-what ledger |
| #1 day-to-day question? | "Just keep me aware" | No budgets/advice engines; facts over nudges |
| #1 long-run question? | "Are we building wealth?" | Combined me+partner **net-worth trajectory** is the headline artifact |
| Medium-term (5–10y) savings for? | Home + kids + growing money | A real third horizon: **daily / medium / long** |
| Couple ritual? | "Each alone, shared truth" | Couple data must be fresh **without ceremony** (auto-sync) |
| CP equity? | ESPP only, track it | ESPP **principal in-flight** from payslips; no RSU/E\*TRADE modeling |
| Amendments | "Left to spend" as a quiet feature; ₪2,000/mo → IBI is "savings" | 5th stat + a **monthly plan** with sent/not-yet detection |

## Features

### F1 — Three horizons everywhere
- `Account.horizon?: 'daily' | 'medium' | 'long'` — optional override. Type defaults are
  unchanged from today so untagged accounts keep their current placement:
  `bank/credit_card → daily`, `investment → long`, `pension → long`. The new `medium`
  horizon is reached only by explicit tags (e.g. Guy tags IBI or MVS components himself).
- `AccountComponent.horizon?` — optional per-component tag. A tagged component moves its value
  to that horizon; untagged components inherit the account.
- MVS stays ONE account with ONE synced total (decision "B"): קרן פנסיה + קופת גמל → `long`,
  קרן השתלמות + קופת גמל להשקעה → `medium`, set via component tags.
- UI: composition area shows **three tiles** (Day-to-day / 5–10y / Long-term) + three-segment
  bar. A small horizon picker (existing cat-picker pattern) on each account row and component
  row in Me view; options: Auto / Day-to-day / 5–10y / Long-term.
- Couple summary: `NetWorthBuckets` gains `medium`. Schema string stays
  `kesef.couple.summary/v1`; readers treat a missing `medium` as 0 (additive, tolerant —
  both partners install from the same repo anyway).
- Storage: `ALTER TABLE accounts ADD COLUMN horizon TEXT` (same try/catch migration pattern
  as `components`); component tags live inside the existing `components` JSON.
- API: `POST /api/horizon { kind: 'account'|'component', accountId, componentName?, horizon: string|null }`
  (null = back to auto). Validated against the three allowed values.

### F2 — Couple net-worth trend
- New table: `couple_snapshots (date TEXT PRIMARY KEY, mine REAL NOT NULL, partner REAL NOT NULL)`.
- On every **successful** `syncWithPartner`: upsert today's row with my summary total and the
  partner's shared total (last sync of the day wins).
- Couple view hero gets the accumulated combined line (mine+partner per date), same spark
  component as Me view. Empty/1-point state shows the existing "trend builds as you sync" note.
- Privacy: stores only values the partner already chose to share, at the time she shared them.
  No backfill of her past — by design, not by limitation.

### F3 — Auto-fresh partner sync ("shared truth without ceremony")
- On dashboard load, if paired: fire a background partner sync, throttled to at most one per
  3 hours (`localStorage` timestamp guard). Silent on failure — the existing "as of" freshness
  line stays the source of truth. Manual button remains.
- Depends on the pairing pointing at a real relay (current pairing is a localhost self-test —
  re-pair is a prerequisite, already tracked).

### F4 — ESPP in flight (principal only — decided)
- Derived purely from `payslips.espp` within the current plan window
  (Feb 1 – Jul 31 / Aug 1 – Jan 31, per Check Point's ESPP).
- One line on the paycheck card: "ESPP in flight: ₪X since <window start> · pays out early
  <month after window end>". Resets naturally when the window rolls.
- **No stock quotes, no estimated value** (decided). Payout cash is caught by the normal bank
  sync when it lands.

### F5 — "Left this month" (quiet, not a budget)
- 5th stat card, shown only for the **This month** period and only when computable.
- `left = incomeBase − spentThisMonth − planNotYetSent`
  - `incomeBase`: `max(this month's bank income, latest payslip net)` — a stray small
    deposit must not mask the salary-hasn't-landed-yet case; once the real salary lands
    it exceeds the payslip net and wins.
  - `planNotYetSent`: F6's amount if the plan hasn't been detected as sent this month, else 0.
- No colors-of-shame, no warnings. A number, a label, done.

### F6 — Monthly plan (₪2,000 → IBI, configurable)
- New table: `monthly_plan (id TEXT PRIMARY KEY, amount REAL NOT NULL, label TEXT NOT NULL)`.
  v1 keeps at most one row (same pattern as couple_pairing).
- Sent-detection for the current month: any outgoing bank transaction whose **effective**
  category (after per-txn override → merchant rule → auto, same resolution as the dashboard)
  is `investment` or `savings`, with `|amount| ≥ 0.95 × plan.amount`.
- `POST /api/plan` upserts the single row (fixed id), matching the one-pairing pattern.
  <!-- ponytail: simple threshold rule; upgrade to per-destination matching if a second plan ever exists -->
- UI: one row near the stats — "₪2,000 to IBI: sent ✓ / not yet" — plus a small form
  (amount + label) behind an edit control. Feeds F5.
- API: `POST /api/plan { amount, label }`, `DELETE /api/plan`.

### F7 — Pay-cycle frame (approved 2026-07-14, "yes to the cycle")
Israeli salaries land at month-end, so calendar-month stats answer a question nobody asks.
- **Salary detection**: an income-category transaction (effective category, so user-correctable
  by re-tagging) with `amount ≥ 0.5 × max(largest income txn in the last 120 days, latest payslip net)`.
  <!-- ponytail: threshold heuristic; a mis-tagged large deposit resets the cycle — fixed by re-tagging it -->
- **Cycle**: starts on the date of the most recent salary event; "This month" becomes the current
  cycle — income = salary + everything since, spent = spending since (whole start day included).
  Label switches to "Since paycheck <date>" (he: "מהמשכורת") when a cycle exists.
- **Plan (F6)** sent-detection scopes to the cycle window (field renamed `sent`).
- **Left (F5)** = cycle.income − cycle.spent − unsent plan; the payslip-net fallback applies only
  when NO salary is detectable (then everything falls back to calendar-month behavior unchanged).
- **Paycheck card** in cycle view shows the slip funding the cycle: month == cycle-start's month,
  else the month before (salary paid Jun 30 or Jul 1 = June's slip). 💎 payroll savings same match.
- Model: `cycle: { start, payslipMonth, income, spent, savedInvested, byCategory } | null` — null
  when no salary event is found (new installs, partner before her first sync).

## Explicitly out of scope (decisions, not accidents)
- Budgets, spending limits, overspend nudges, safe-to-spend *systems* (F5 is one derived line).
- Who-paid-what / settle-up ledgers.
- Review-ceremony screens or scheduled reports.
- RSU / E\*TRADE holdings modeling.
- Stock-quote fetching or any market-data calls.
- Partner history backfill.
- **Any investment advice**: no "what to buy next", no target-allocation math, no security
  recommendations (dropped by Guy after the licensed-advice boundary was raised).

## Data-model summary
- `accounts` + `horizon TEXT NULL` (migration: try/catch ALTER, like `components`).
- `components` JSON entries: optional `horizon` field.
- New `couple_snapshots(date PK, mine, partner)`.
- New `monthly_plan(id PK, amount, label)`.
- `CoupleSummary.byBucket` + `medium` (tolerant read; schema string unchanged).

## Testing
- Core: horizon resolution (type default vs account override vs component tag) drives
  bucket math in both `buildDashboard` composition and `buildShareableSummary`; missing
  `medium` in an old partner blob reads as 0.
- Store: couple_snapshots upsert (same-day overwrite), monthly_plan CRUD, horizon column
  migration on an existing DB file.
- Ingestion/app: plan sent-detection (positive, sub-threshold, wrong-category cases);
  ESPP window math at boundaries (Jan/Feb and Jul/Aug payslips).
- UI checks ride on the existing pattern: server-injected model, browser verification.

## Build order (suggested for the plan)
1. F1 horizons (schema + core buckets + tiles + picker) — unblocks truthful composition.
2. F4 ESPP line + F5 left-this-month + F6 plan (all small, mostly dashboard + tiny tables).
3. F2 couple snapshots + trend (core + store + UI).
4. F3 auto-sync (depends on re-pair against a real relay).
