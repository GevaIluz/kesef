import { join } from 'node:path';
import { CompanyTypes } from 'israeli-bank-scrapers';
import type { Store } from '@kesef/core';
import { kesefDir } from './paths.js';
import { scrapeInteractive } from './interactive.js';
import { assignCategory } from './categorize.js';
import { loadOverrides } from './overrides.js';
import { readPortalTotal } from './portal.js';
import { manualAccountFor } from './manualAccounts.js';
import { loadPortalConfig, savePortalConfig } from './portalConfig.js';

/** Progress events streamed to the UI during a sync run. */
export type SyncEvent =
  | { type: 'start'; sources: string[] }
  | { type: 'source-start'; source: string; hint?: string }
  | { type: 'source-done'; source: string; accounts?: number; transactions?: number; value?: number }
  | { type: 'source-error'; source: string; message: string }
  | { type: 'complete'; transactions: number; accounts: number }
  | { type: 'fatal'; message: string };

export type SyncSource = 'beinleumi' | 'cal' | 'ibi' | 'mvs';

export interface SyncOptions {
  store: Store;
  now: string;                       // YYYY-MM-DD
  onEvent: (e: SyncEvent) => void;
  sources?: SyncSource[];            // which sources to run; default = all
}

/**
 * Portal-read sources: the user logs in and clicks their total once; kesef reads it automatically
 * from then on. The snapshot lands on `account` — created only if missing, so a user-renamed
 * account (e.g. "MVS — Mivtach Simon") keeps its name and components.
 */
const PORTALS = [
  { key: 'ibi' as const, label: 'IBI', defaultUrl: 'https://sparkibi.ordernet.co.il/#/auth', account: manualAccountFor('ibi') },
  { key: 'mvs' as const, label: 'Mivtach Simon', defaultUrl: 'https://private.mvs.co.il/#/login', account: { ...manualAccountFor('pension'), displayName: 'Mivtach Simon' } },
];

/**
 * Run a full sync across all sources. Each bank/card opens a browser for interactive login
 * (no credentials stored); portals (IBI, MVS) are read automatically from their saved selector,
 * or taught once. Emits progress via onEvent so the app can show it live.
 */
export async function runSync(opts: SyncOptions): Promise<void> {
  const { store, now, onEvent } = opts;
  const overrides = loadOverrides();
  const want: SyncSource[] = opts.sources && opts.sources.length ? opts.sources : ['beinleumi', 'cal', 'ibi', 'mvs'];
  const banks = [
    { companyId: CompanyTypes.beinleumi, institution: 'beinleumi' as const, accountType: 'bank' as const, label: 'Beinleumi' },
    { companyId: CompanyTypes.visaCal, institution: 'cal' as const, accountType: 'credit_card' as const, label: 'Cal' },
  ].filter(b => want.includes(b.institution));
  const portals = PORTALS.filter(p => want.includes(p.key));
  onEvent({ type: 'start', sources: [...banks.map(b => b.label), ...portals.map(p => p.label)] });

  for (const t of banks) {
    onEvent({ type: 'source-start', source: t.label, hint: 'log in in the window that just opened' });
    try {
      const res = await scrapeInteractive(
        { companyId: t.companyId, institution: t.institution, accountType: t.accountType },
        { now, verbose: true, failureScreenshotPath: join(kesefDir(), `last-failure-${t.institution}.png`) },
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

  for (const p of portals) {
    const cfg = loadPortalConfig(p.key);
    const url = cfg.url || p.defaultUrl;
    onEvent({ type: 'source-start', source: p.label, hint: cfg.selector ? 'log in — your total is read automatically' : 'log in, then click your portfolio total once' });
    try {
      const r = await readPortalTotal({
        url,
        savedSelector: cfg.selector,
        autoTimeoutMs: 180_000,
        clickTimeoutMs: 180_000,
        failureScreenshotPath: join(kesefDir(), `last-failure-${p.key}.png`),
        waitForLogin: async () => { /* no terminal gate in app mode */ },
        promptClick: () => { /* the in-page banner tells the user to click */ },
      });
      if (r.value !== null) {
        if (r.mode === 'taught' && r.selector) savePortalConfig(p.key, { url, selector: r.selector });
        const spec = p.account;
        if (!store.listAccounts().some(a => a.id === spec.id)) {
          store.upsertAccount({ id: spec.id, institution: spec.institution, type: spec.type, displayName: spec.displayName, currency: 'ILS', shareable: false });
        }
        store.upsertBalanceSnapshot({ id: `${spec.id}@${now}`, accountId: spec.id, date: now, balance: r.value });
        onEvent({ type: 'source-done', source: p.label, value: r.value });
      } else {
        onEvent({ type: 'source-error', source: p.label, message: r.error || 'no value captured — open your portfolio screen and click the total' });
      }
    } catch (e) {
      onEvent({ type: 'source-error', source: p.label, message: e instanceof Error ? e.message : 'error' });
    }
  }

  onEvent({ type: 'complete', transactions: store.countTransactions(), accounts: store.countAccounts() });
}
