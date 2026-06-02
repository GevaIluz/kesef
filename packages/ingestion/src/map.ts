import type { Account, Transaction, BalanceSnapshot } from '@kesef/core';
import { txId } from './txid';

// Minimal structural view of israeli-bank-scrapers output.
export interface ScrapeAccount { accountNumber: string; balance?: number; txns: ScrapeTxn[]; }
export interface ScrapeTxn {
  date: string; chargedAmount: number; description: string; status?: string;
  identifier?: number | string | null;
}
export interface ScrapeResult { success?: boolean; accounts?: ScrapeAccount[]; }

const ymd = (iso: string): string => iso.slice(0, 10);
const acctId = (accountNumber: string): string => 'beinleumi:' + accountNumber;

export interface MapOptions { now: string; } // ISO date for the balance snapshot

export function mapScrapeResult(r: ScrapeResult, opts: MapOptions): {
  accounts: Account[]; transactions: Transaction[]; snapshots: BalanceSnapshot[];
} {
  const accounts: Account[] = [];
  const transactions: Transaction[] = [];
  const snapshots: BalanceSnapshot[] = [];
  for (const a of r.accounts ?? []) {
    const id = acctId(a.accountNumber);
    accounts.push({ id, institution: 'beinleumi', type: 'bank', displayName: a.accountNumber, currency: 'ILS', shareable: false });
    if (typeof a.balance === 'number') {
      snapshots.push({ id: id + '@' + opts.now, accountId: id, date: opts.now, balance: a.balance });
    }
    for (const t of a.txns ?? []) {
      const date = ymd(t.date);
      transactions.push({
        id: txId({ accountNumber: a.accountNumber, date, chargedAmount: t.chargedAmount, description: t.description, identifier: t.identifier ?? null }),
        accountId: id, date, amount: t.chargedAmount, description: t.description, shareable: false,
      });
    }
  }
  return { accounts, transactions, snapshots };
}
