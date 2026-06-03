# Phase 5: All your money — pension, provident fund & other balances

> Status: PLANNED (not built). Requested by Guy: "the next we want to put in it all of our
> money from everywhere (pension, provident fund, etc)."

## Goal
Bring **everything** into net worth + forecasting, not just the bank + credit card:
- **קרן השתלמות** (keren hishtalmut / study fund)
- **קופת גמל / פנסיה** (gemel / pension)
- **IBI** investment portfolio (already modelled as `institution: 'ibi'`)
- Any other account (Leumi rent account, savings, cash) as a manual balance.

These have **no scraper** in `israeli-bank-scrapers` → they come in as **manual balance
snapshots** (a value on a date), which the net-worth series + forecasting already consume.

## What already works TODAY (no build needed)
`npm run add-balance` already records manual snapshots for these account types:
- `ibi`      → `ibi:portfolio` (investment)
- `pension`  → `manual:pension` (pension)
- `other`    → `manual:<slug>` (e.g. gemel, keren-hishtalmut, leumi) with a display name

Each entry asks for a **value in ₪** and a **date**, writes an `Account` + a
`BalanceSnapshot`, and immediately counts toward **net worth** and the **trend sparkline**.
So Guy can seed pension/gemel right now from the terminal.

## Why it still feels incomplete (the gaps to close in Phase 5)
1. **No in-app entry.** Adding/updating a balance requires the CLI. Net-worth accounts should
   be addable + editable from the dashboard (a small "Accounts & balances" panel).
2. **Account types aren't surfaced.** Pension/gemel/keren show only inside net worth; there's
   no breakdown card ("retirement vs liquid vs investments").
3. **Forecasting doesn't use contributions.** Pension/keren grow via monthly contributions +
   return; today the trend is just snapshot-to-snapshot. A transparent projection (monthly
   contribution + assumed annual return, clearly "not advice") would make "plan ahead" real.
4. **Stale balances.** Manual balances need periodic re-entry; the UI should show "as of <date>"
   and nudge when a balance is old.

## Proposed build (each piece checks in)
- **P5-T1 — In-app balances panel.** `GET` exposes accounts+latest balances (already in the
  model); add `POST /api/balance {kind, name, value, date}` (127.0.0.1 only) + an "Accounts"
  card to add/update a manual balance. Reuse the `add-balance` logic.
- **P5-T2 — Net-worth composition.** A breakdown (liquid / investments / retirement / liabilities)
  using `Account.type`; a small stacked bar or grouped legend. Mark retirement (pension/gemel/
  keren) as long-term so it's visually distinct from spendable cash.
- **P5-T3 — Contribution-aware forecast.** Optional per-account "≈ ₪X/month in, ≈ Y% / yr"
  → transparent projection line to a target date. Labelled "estimate, not financial advice."
- **P5-T4 — "as of" + freshness.** Show each manual balance's date; flag balances older than
  ~45 days for a refresh.

## Research / open questions (do before P5-T3)
- Do the providers (e.g. מיטב, אלטשולר שחם, מנורה, IBI) expose CSV/PDF statements Guy can
  drop in for a one-shot import? If so, a CSV importer beats manual entry. (No live scraping —
  most are MFA-walled; manual/CSV stays the privacy-safe path.)
- Keren hishtalmut tax status (liquid after 6 years) — worth a flag so net worth can show
  "accessible now" vs "locked".

## Out of scope
Live scraping of pension/gemel portals; couple-view sharing of retirement (that rides on the
existing per-item `shareable` flag when Phase 4 couple-sync lands).
