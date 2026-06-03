import { CompanyTypes } from 'israeli-bank-scrapers';
import type { Store } from '@kesef/core';
import { scrapeInteractive } from './interactive.js';
import { assignCategory } from './categorize.js';
import { loadOverrides } from './overrides.js';
import { readIbiTotal } from './ibi.js';
import { manualAccountFor } from './manualAccounts.js';
import { loadIbiConfig, saveIbiConfig } from './ibiConfig.js';

/** Progress events streamed to the UI during a sync run. */
export type SyncEvent =
  | { type: 'start'; sources: string[] }
  | { type: 'source-start'; source: string; hint?: string }
  | { type: 'source-done'; source: string; accounts?: number; transactions?: number; value?: number }
  | { type: 'source-error'; source: string; message: string }
  | { type: 'complete'; transactions: number; accounts: number }
  | { type: 'fatal'; message: string };

export interface SyncOptions {
  store: Store;
  now: string;                       // YYYY-MM-DD
  onEvent: (e: SyncEvent) => void;
  includeIbi?: boolean;              // default true
  ibiUrl?: string;
}

const DEFAULT_IBI_URL = 'https://sparkibi.ordernet.co.il/#/auth';

/**
 * Run a full sync across all sources. Each bank/card opens a browser for interactive login
 * (no credentials stored); IBI is read automatically from its saved selector, or taught once.
 * Emits progress via onEvent so the app can show it live.
 */
export async function runSync(opts: SyncOptions): Promise<void> {
  const { store, now, onEvent } = opts;
  const overrides = loadOverrides();
  const banks = [
    { companyId: CompanyTypes.beinleumi, institution: 'beinleumi' as const, accountType: 'bank' as const, label: 'Beinleumi' },
    { companyId: CompanyTypes.visaCal, institution: 'cal' as const, accountType: 'credit_card' as const, label: 'Cal' },
  ];
  const includeIbi = opts.includeIbi !== false;
  onEvent({ type: 'start', sources: [...banks.map(b => b.label), ...(includeIbi ? ['IBI'] : [])] });

  for (const t of banks) {
    onEvent({ type: 'source-start', source: t.label, hint: 'log in in the window that just opened' });
    try {
      const res = await scrapeInteractive(
        { companyId: t.companyId, institution: t.institution, accountType: t.accountType },
        { now },
      );
      if (!res.ok) {
        onEvent({ type: 'source-error', source: t.label, message: `${res.errorType ?? ''} ${res.errorMessage ?? ''}`.trim() || 'login failed' });
        continue;
      }
      const { accounts, transactions, snapshots } = res.data!;
      for (const tx of transactions) tx.category = assignCategory(tx, overrides);
      for (const a of accounts) store.upsertAccount(a);
      for (const tx of transactions) store.upsertTransaction(tx);
      for (const s of snapshots) store.upsertBalanceSnapshot(s);
      onEvent({ type: 'source-done', source: t.label, accounts: accounts.length, transactions: transactions.length });
    } catch (e) {
      onEvent({ type: 'source-error', source: t.label, message: e instanceof Error ? e.message : 'error' });
    }
  }

  if (includeIbi) {
    const cfg = loadIbiConfig();
    const url = opts.ibiUrl || cfg.url || DEFAULT_IBI_URL;
    onEvent({ type: 'source-start', source: 'IBI', hint: cfg.selector ? 'log in — your total is read automatically' : 'log in, then click your portfolio total once' });
    try {
      const r = await readIbiTotal({
        url,
        savedSelector: cfg.selector,
        autoTimeoutMs: 180_000,
        clickTimeoutMs: 180_000,
        waitForLogin: async () => { /* no terminal gate in app mode */ },
        promptClick: () => { /* the in-page banner tells the user to click */ },
      });
      if (r.value !== null) {
        if (r.mode === 'taught' && r.selector) saveIbiConfig({ url, selector: r.selector });
        const spec = manualAccountFor('ibi');
        store.upsertAccount({ id: spec.id, institution: spec.institution, type: spec.type, displayName: spec.displayName, currency: 'ILS', shareable: false });
        store.upsertBalanceSnapshot({ id: `${spec.id}@${now}`, accountId: spec.id, date: now, balance: r.value });
        onEvent({ type: 'source-done', source: 'IBI', value: r.value });
      } else {
        onEvent({ type: 'source-error', source: 'IBI', message: 'no value captured — open your portfolio screen and click the total' });
      }
    } catch (e) {
      onEvent({ type: 'source-error', source: 'IBI', message: e instanceof Error ? e.message : 'error' });
    }
  }

  onEvent({ type: 'complete', transactions: store.countTransactions(), accounts: store.countAccounts() });
}
