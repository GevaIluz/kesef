// All data is locale-neutral: numbers, ISO-8601 date strings, and stable codes.
// The bilingual (he/en) UI localizes these at render time — never store localized text here.

export type Currency = 'ILS';
export type AccountType = 'bank' | 'credit_card' | 'investment' | 'pension';

/** Stable category codes; UI maps these to he/en labels. */
export type CategoryCode =
  | 'groceries' | 'dining' | 'transport' | 'housing' | 'utilities'
  | 'health' | 'shopping' | 'entertainment' | 'income' | 'transfer'
  | 'savings' | 'investment' | 'fees' | 'other';

/** Optional breakdown of an account's value (e.g. MVS products, fund holdings). */
export interface AccountComponent { name: string; value: number }

export interface Account {
  id: string;
  institution: 'beinleumi' | 'cal' | 'ibi' | 'manual';
  type: AccountType;
  displayName: string;        // user-entered; shown as-is in either language
  currency: Currency;
  shareable: boolean;         // per-item couple-sharing flag (default false)
  components?: AccountComponent[]; // optional sub-breakdown of the balance
}

export interface Transaction {
  id: string;
  accountId: string;
  date: string;               // ISO-8601 (YYYY-MM-DD)
  amount: number;             // signed; negative = expense, positive = income
  description: string;
  rawCategory?: string;       // category as reported by the source, if any
  category?: CategoryCode;    // assigned by the categorization engine (Phase 2)
  shareable?: boolean;        // overrides account default when set
}

export interface BalanceSnapshot {
  id: string;
  accountId: string;
  date: string;               // ISO-8601
  balance: number;            // signed; liabilities (e.g. credit card) negative
}

export interface Goal {
  id: string;
  name: string;               // user-entered
  targetAmount: number;
  targetDate?: string;        // ISO-8601; optional — a goal need not have a deadline
  currentAmount: number;
  shareable: boolean;
}

/** Couple pairing record — NON-secret metadata. The secret S_pair lives in the OS keychain. */
export interface CouplePairing {
  pairingId: string;
  role: 'A' | 'B';            // which relay slot this device owns
  partnerLabel?: string;      // local nickname for the partner (display only)
  relayUrl?: string;          // where the encrypted blobs are exchanged
  createdAt: string;          // ISO date
  localSeq: number;           // last seq this device uploaded (monotonic)
  partnerSeq: number;         // highest partner seq this device has accepted
}

export function isExpense(tx: Transaction): boolean {
  return tx.amount < 0;
}
