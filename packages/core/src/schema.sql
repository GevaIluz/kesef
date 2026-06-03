CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  institution TEXT NOT NULL,
  type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  currency TEXT NOT NULL,
  shareable INTEGER NOT NULL DEFAULT 0
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
