// All data is locale-neutral: numbers, ISO-8601 date strings, and stable codes.
// The bilingual (he/en) UI localizes these at render time — never store localized text here.

export type Currency = 'ILS';
export type AccountType = 'bank' | 'credit_card' | 'investment' | 'pension';

/** Stable category codes; UI maps these to he/en labels. */
export type CategoryCode =
  | 'groceries' | 'dining' | 'transport' | 'housing' | 'utilities'
  | 'health' | 'shopping' | 'entertainment' | 'income' | 'transfer'
  | 'savings' | 'investment' | 'fees' | 'other';

/**
 * How soon money is meant to be used. Untagged accounts/components keep today's type-driven
 * placement (see resolveHorizon); 'medium' is reached only through an explicit tag — no type
 * defaults to it.
 */
export type Horizon = 'daily' | 'medium' | 'long';

/** Optional breakdown of an account's value (e.g. MVS products, fund holdings). */
export interface AccountComponent { name: string; value: number; horizon?: Horizon }

export interface Account {
  id: string;
  institution: 'beinleumi' | 'cal' | 'ibi' | 'manual';
  type: AccountType;
  displayName: string;        // user-entered; shown as-is in either language
  currency: Currency;
  shareable: boolean;         // per-item couple-sharing flag (default false)
  horizon?: Horizon;          // optional override of the type default (unset = "Auto")
  components?: AccountComponent[]; // optional sub-breakdown of the balance
}

/** Type-default horizon for an untagged account — the placement kesef has always used. */
const TYPE_HORIZON: Record<AccountType, Horizon> = {
  bank: 'daily', credit_card: 'daily', investment: 'long', pension: 'long',
};

/**
 * Resolve the effective horizon for a chunk of money: an explicit component tag beats an
 * explicit account override beats the account type's default.
 */
export function resolveHorizon(type: AccountType, accountHorizon?: Horizon | null, componentHorizon?: Horizon | null): Horizon {
  return componentHorizon ?? accountHorizon ?? TYPE_HORIZON[type];
}

/** Three-way split of one account's current balance across horizons. */
export interface HorizonTotals { daily: number; medium: number; long: number }

/**
 * Split an account's balance across horizons: each tagged component's value moves to its own
 * horizon; untagged components and the part of the balance no component accounts for ("remainder")
 * inherit the account's own resolved horizon. Shared by buildDashboard's composition tiles and
 * buildShareableSummary's net-worth buckets so both agree on where money "lives".
 */
export function horizonSplit(account: Account, balance: number): HorizonTotals {
  const totals: HorizonTotals = { daily: 0, medium: 0, long: 0 };
  const acctHorizon = resolveHorizon(account.type, account.horizon);
  const comps = account.components ?? [];
  if (comps.length === 0) { totals[acctHorizon] += balance; return totals; }
  let compSum = 0;
  for (const c of comps) {
    const h = resolveHorizon(account.type, account.horizon, c.horizon);
    totals[h] += c.value;
    compSum += c.value;
  }
  totals[acctHorizon] += balance - compSum; // the part of the balance no component itemizes
  return totals;
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

/** One month's payslip — the gross→net story the bank never sees. All amounts in ILS. */
export interface Payslip {
  month: string;              // YYYY-MM
  gross: number;              // total payments (bruto)
  net: number;                // what actually reaches the bank
  tax: number;                // mandatory: income tax + national insurance + health
  pensionEmp: number;         // employee pension deduction
  kerenEmp: number;           // employee study-fund deduction
  espp: number;               // voluntary ESPP deduction (returns as cash at plan end)
  otherEmp: number;           // any other voluntary deduction
  employerPension: number;    // employer contributions — savings on top of gross
  employerSeverance: number;
  employerKeren: number;
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

/** The monthly plan (F6) — a quiet savings/investment intent, e.g. "₪2,000 to IBI". v1 keeps at most one. */
export interface MonthlyPlan {
  amount: number; // > 0
  label: string;  // non-empty, e.g. "IBI"
}

export function isExpense(tx: Transaction): boolean {
  return tx.amount < 0;
}
