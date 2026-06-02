import type { Account, Transaction, BalanceSnapshot } from '@kesef/core';
import { txId } from './txid';

// Minimal structural view of israeli-bank-scrapers output.
export interface ScrapeAccount { accountNumber: string; balance?: number; txns: ScrapeTxn[]; }
export interface ScrapeTxn {
  date: string; chargedAmount: number; description: string; status?: string;
  identifier?: number | string | null;
  category?: string;
}
export interface ScrapeResult { success?: boolean; accounts?: ScrapeAccount[]; }

export interface MapOptions { institution: Account['institution']; accountType: Account['type']; now: string; }

export function mapScrapeResult(r: ScrapeResult, opts: MapOptions): {
  accounts: Account[]; transactions: Transaction[]; snapshots: BalanceSnapshot[];
} {
  const accounts: Account[] = []; const transactions: Transaction[] = []; const snapshots: BalanceSnapshot[] = [];
  for (const a of r.accounts ?? []) {
    const id = `${opts.institution}:${a.accountNumber}`;
    accounts.push({ id, institution: opts.institution, type: opts.accountType, displayName: a.accountNumber, currency: 'ILS', shareable: false });
    if (typeof a.balance === 'number') {
      snapshots.push({ id: `${id}@${opts.now}`, accountId: id, date: opts.now, balance: a.balance });
    }
    for (const t of a.txns ?? []) {
      const date = t.date.slice(0, 10);
      const tx: Transaction = {
        id: txId({ accountNumber: a.accountNumber, date, chargedAmount: t.chargedAmount, description: t.description, identifier: t.identifier ?? null }),
        accountId: id, date, amount: t.chargedAmount, description: t.description, shareable: false,
      };
      if (t.category && t.category.trim()) tx.rawCategory = t.category.trim();
      transactions.push(tx);
    }
  }
  return { accounts, transactions, snapshots };
}
