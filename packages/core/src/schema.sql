CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  institution TEXT NOT NULL,
  type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  currency TEXT NOT NULL,
  shareable INTEGER NOT NULL DEFAULT 0,
  components TEXT,
  horizon TEXT
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  description TEXT NOT NULL,
  raw_category TEXT,
  category TEXT,
  shareable INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tx_account_date ON transactions(account_id, date);

CREATE TABLE IF NOT EXISTS balance_snapshots (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  date TEXT NOT NULL,
  balance REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  target_amount REAL NOT NULL,
  target_date TEXT NOT NULL,
  current_amount REAL NOT NULL,
  shareable INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tx_overrides (
  transaction_id TEXT PRIMARY KEY,
  category TEXT NOT NULL
);

-- Merchant-level category rules: re-tagging a merchant applies to all its
-- transactions (past and future syncs) so the app "learns" durably.
CREATE TABLE IF NOT EXISTS merchant_rules (
  merchant TEXT PRIMARY KEY,
  category TEXT NOT NULL
);

-- Payslips: the pre-bank truth, one row per month. The bank only ever sees `net`;
-- the gross→net gap (taxes, pension/keren deductions, ESPP) plus the employer's
-- contributions is money that moves BEFORE it ever reaches an account — which is
-- where most real saving happens.
CREATE TABLE IF NOT EXISTS payslips (
  month TEXT PRIMARY KEY,               -- YYYY-MM
  gross REAL NOT NULL,
  net REAL NOT NULL,
  tax REAL NOT NULL DEFAULT 0,          -- mandatory: income tax + national insurance + health
  pension_emp REAL NOT NULL DEFAULT 0,  -- employee pension deduction
  keren_emp REAL NOT NULL DEFAULT 0,    -- employee study-fund deduction
  espp REAL NOT NULL DEFAULT 0,         -- voluntary ESPP deduction
  other_emp REAL NOT NULL DEFAULT 0,    -- any other voluntary deduction
  employer_pension REAL NOT NULL DEFAULT 0,
  employer_severance REAL NOT NULL DEFAULT 0,
  employer_keren REAL NOT NULL DEFAULT 0
);

-- Couple pairing: NON-secret metadata only. The pairing secret (S_pair) lives in
-- the OS keychain, never here. local_seq/partner_seq track the monotonic blob
-- sequence in each relay slot. v1 holds at most one pairing.
CREATE TABLE IF NOT EXISTS couple_pairing (
  pairing_id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  partner_label TEXT,
  relay_url TEXT,
  created_at TEXT NOT NULL,
  local_seq INTEGER NOT NULL DEFAULT 0,
  partner_seq INTEGER NOT NULL DEFAULT 0
);

-- Monthly plan (F6): one quiet savings/investment intent (e.g. "₪2,000 → IBI"). v1 holds at most
-- one row, upserted at a fixed id (see Store.PLAN_ID) — same one-row shape as couple_pairing.
CREATE TABLE IF NOT EXISTS monthly_plan (
  id TEXT PRIMARY KEY,
  amount REAL NOT NULL,
  label TEXT NOT NULL
);

-- Couple net-worth trend (F2): one row per day a sync SUCCEEDED at opening the partner's blob.
-- date is the PK so re-syncing the same day overwrites (last sync of the day wins); no backfill.
CREATE TABLE IF NOT EXISTS couple_snapshots (
  date TEXT PRIMARY KEY,
  mine REAL NOT NULL,
  partner REAL NOT NULL
);
