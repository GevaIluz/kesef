# Phase 2c: Cal card source + card-network categories + multi-institution CLI

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. TDD; checkbox steps.

**Goal:** Solve "who is ל.ל אחזקות בע״מ?" with data, not guesses — pull the **Cal credit card**, whose
transactions arrive **pre-categorized by the card network** (`branchCodeDesc`), map that category to our
buckets (card category wins; the Hebrew rule engine is the fallback), and let `connect`/`sync` handle both
**Beinleumi (bank)** and **Cal (card)**. A local `list` command lets us see + refine real categories.
Local-only (no external lookups), per the user's choice.

**Recon (installed `israeli-bank-scrapers@6.7.5`):** Cal = `CompanyTypes.visaCal`, credentials
`{ username, password }`. Each Cal txn is mapped with `description = merchantName`, `category =
branchCodeDesc` (Cal's own category, populated by default — no `additionalTransactionInformation` needed).
Result/account/txn shapes match what `mapScrapeResult` already consumes (plus the `category` field).

**Reuses:** `mapScrapeResult` (generalized), `txId`, `categorize`/overrides, `Store` upserts, the
visible-browser + 90s-timeout pattern from Beinleumi (Cal logins are likely the same).

---

## Task 1: `cal` institution + capture the card category in the mapper — TDD

**Files:** modify `packages/core/src/types.ts`; modify `packages/ingestion/src/map.ts` + `beinleumi.ts`; modify `packages/ingestion/test/map.test.ts`.

- [ ] **Step 1: Update the failing test** — in `packages/ingestion/test/map.test.ts`, change the `mapScrapeResult` call to the new signature and add a category assertion. Replace the `const out = mapScrapeResult(result as any, { now: '2026-05-03' });` line with:
```ts
const out = mapScrapeResult(result as any, { institution: 'beinleumi', accountType: 'bank', now: '2026-05-03' });
```
And add this test inside the describe:
```ts
  it('captures the source category as rawCategory when present', () => {
    const r = { success: true, accounts: [{ accountNumber: 'c1', txns: [
      { date: '2026-05-01T00:00:00Z', chargedAmount: -90, description: 'ל.ל אחזקות בע״מ', category: 'מסעדות', identifier: 5 },
    ] }] };
    const o = mapScrapeResult(r as any, { institution: 'cal', accountType: 'credit_card', now: '2026-05-02' });
    expect(o.accounts[0]!.institution).toBe('cal');
    expect(o.accounts[0]!.type).toBe('credit_card');
    expect(o.transactions[0]!.rawCategory).toBe('מסעדות');
    expect(o.accounts[0]!.id).toBe('cal:c1');
  });
```

- [ ] **Step 2: Run → fails** (`npm test -- map`).

- [ ] **Step 3: Implement.** In `packages/core/src/types.ts`, extend the institution union:
```ts
  institution: 'beinleumi' | 'cal' | 'ibi' | 'manual';
```
In `packages/ingestion/src/map.ts`: add `category?: string` to `ScrapeTxn`; change `MapOptions` and `mapScrapeResult`:
```ts
export interface ScrapeTxn {
  date: string; chargedAmount: number; description: string; status?: string;
  category?: string;                       // source/card category (e.g. Cal branchCodeDesc)
  identifier?: number | string | null;
}
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
```
(Delete the old `acctId`/`ymd` helpers if now unused, or keep `ymd` inline as above.)
In `packages/ingestion/src/beinleumi.ts`, update the mapper call:
```ts
  return { ok: true, data: mapScrapeResult(result, { institution: 'beinleumi', accountType: 'bank', now: deps.now }) };
```

- [ ] **Step 4: Run → passes** (`npm test`); `npm run typecheck` clean. Do NOT commit.

---

## Task 2: Cal adapter + card-category map + category precedence — TDD

**Files:** create `packages/ingestion/src/cal.ts`, `packages/ingestion/src/cardCategory.ts`; modify `packages/ingestion/src/categorize.ts` (add `assignCategory`); export from `index.ts`; create `packages/ingestion/test/cardCategory.test.ts`.

- [ ] **Step 1: Failing test** — `packages/ingestion/test/cardCategory.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mapCardCategory } from '../src/cardCategory';
import { assignCategory } from '../src/categorize';

describe('mapCardCategory', () => {
  it('maps known Cal categories (Hebrew) to our buckets', () => {
    expect(mapCardCategory('מסעדות ובתי קפה')).toBe('dining');
    expect(mapCardCategory('סופרמרקטים')).toBe('groceries');
    expect(mapCardCategory('דלק')).toBe('transport');
  });
  it('returns undefined for unknown card categories', () => {
    expect(mapCardCategory('משהו אחר')).toBeUndefined();
  });
});

describe('assignCategory precedence', () => {
  it('prefers a mappable card category over description rules', () => {
    // description is an opaque legal name; the card category says dining
    expect(assignCategory({ description: 'ל.ל אחזקות בע״מ', rawCategory: 'מסעדות ובתי קפה' })).toBe('dining');
  });
  it('falls back to description rules when card category is missing/unmappable', () => {
    expect(assignCategory({ description: 'שופרסל', rawCategory: undefined })).toBe('groceries');
    expect(assignCategory({ description: 'שופרסל', rawCategory: 'קטגוריה לא ידועה' })).toBe('groceries');
  });
  it('honours user overrides above everything', () => {
    expect(assignCategory({ description: 'ל.ל אחזקות', rawCategory: 'מסעדות ובתי קפה' }, { 'ל.ל אחזקות': 'other' })).toBe('other');
  });
});
```

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement `cardCategory.ts`** (seed mapping; refine once we see real Cal `branchCodeDesc` values via `list`):
```ts
import type { CategoryCode } from '@kesef/core';

// Cal `branchCodeDesc` (and similar card categories) → our buckets. Substring match, Hebrew.
// PROVISIONAL seed — refine against real values surfaced by `npm run list`.
const CARD_MAP: ReadonlyArray<readonly [CategoryCode, readonly string[]]> = [
  ['dining',        ['מסעד', 'בתי קפה', 'בית קפה', 'קפה', 'מזון מהיר', 'פיצ']],
  ['groceries',     ['סופרמרקט', 'סופר מרקט', 'מזון', 'מכולת', 'שוק']],
  ['transport',     ['דלק', 'תחבורה', 'חני', 'מוסך', 'רכב', 'תחבורה ציבורית']],
  ['utilities',     ['חשמל', 'תקשורת', 'סלולר', 'אינטרנט', 'מים', 'גז']],
  ['health',        ['בריאות', 'פארם', 'בתי מרקחת', 'רפואה', 'קופת חולים']],
  ['entertainment', ['בידור', 'פנאי', 'תרבות', 'קולנוע', 'סטרימינג']],
  ['shopping',      ['ביגוד', 'הלבשה', 'אופנה', 'חשמל ואלקטרוניקה', 'ריהוט', 'כלבו', 'צעצועים', 'ספרים']],
  ['housing',       ['שכר דירה', 'דיור', 'ארנונה', 'ועד בית']],
  ['health',        ['ספורט', 'כושר']],
  ['fees',          ['עמלות', 'ריבית', 'דמי כרטיס']],
  ['transport',     ['נסיעות', 'תיירות', 'טיסות', 'מלונות']],
];

/** Map a card-provided category string to our bucket, or undefined if unrecognised. */
export function mapCardCategory(raw: string | undefined): CategoryCode | undefined {
  if (!raw) return undefined;
  const hay = raw.toLowerCase();
  for (const [code, subs] of CARD_MAP) if (subs.some(s => hay.includes(s))) return code;
  return undefined;
}
```

- [ ] **Step 4: Implement `assignCategory`** — append to `packages/ingestion/src/categorize.ts`:
```ts
import { mapCardCategory } from './cardCategory.js';

/** Decide a transaction's category: user override → card-provided category → description rules → other. */
export function assignCategory(
  t: { description: string; rawCategory?: string | undefined },
  overrides?: Record<string, CategoryCode>,
): CategoryCode {
  // overrides win (checked inside categorize for the description, but also against rawCategory intent):
  const fromCard = mapCardCategory(t.rawCategory);
  if (overrides) {
    const hay = t.description.toLowerCase();
    for (const [sub, cat] of Object.entries(overrides)) if (sub && hay.includes(sub.toLowerCase())) return cat;
  }
  if (fromCard) return fromCard;
  return categorize(t.description, overrides);
}
```
Add `export * from './cal.js'; export * from './cardCategory.js';` to `index.ts`.

- [ ] **Step 5: Implement the Cal adapter** — `packages/ingestion/src/cal.ts` (mirror beinleumi.ts; Cal credentials are `{username,password}`; category arrives by default):
```ts
import { createScraper, CompanyTypes } from 'israeli-bank-scrapers';
import { mapScrapeResult, type ScrapeResult } from './map.js';

export interface CalCreds { username: string; password: string; }
export interface CalScrapeDeps {
  scraperFactory?: typeof createScraper;
  startDate?: Date; now: string;
  showBrowser?: boolean; verbose?: boolean; failureScreenshotPath?: string; timeoutMs?: number;
}
export interface CalOutcome { ok: boolean; errorType?: string; errorMessage?: string; data?: ReturnType<typeof mapScrapeResult>; }

export async function scrapeCal(creds: CalCreds, deps: CalScrapeDeps): Promise<CalOutcome> {
  const factory = deps.scraperFactory ?? createScraper;
  const startDate = deps.startDate ?? new Date(Date.now() - 1000 * 60 * 60 * 24 * 90);
  const timeout = deps.timeoutMs ?? 90000;
  const scraper = factory({
    companyId: CompanyTypes.visaCal, startDate, combineInstallments: false,
    timeout, defaultTimeout: timeout,
    showBrowser: deps.showBrowser ?? false, verbose: deps.verbose ?? false,
    storeFailureScreenShotPath: deps.failureScreenshotPath,
  });
  const result = await scraper.scrape(creds) as ScrapeResult & { errorType?: string; errorMessage?: string };
  if (!result.success) return { ok: false, errorType: result.errorType, errorMessage: result.errorMessage };
  return { ok: true, data: mapScrapeResult(result, { institution: 'cal', accountType: 'credit_card', now: deps.now }) };
}
```

- [ ] **Step 6: Run → passes** (`npm test`), `npm run typecheck` clean. Do NOT commit.

---

## Task 3: Multi-institution `connect`/`sync` + `list` — CLI

**Files:** modify `packages/ingestion/src/cli.ts`; modify root `package.json`.

- [ ] **Step 1: Generalise `connect`** to pick an institution and store creds under a per-institution key:
```ts
async function connect(): Promise<void> {
  const inst = (await ask('Connect which? (beinleumi / cal): ')).toLowerCase() === 'cal' ? 'cal' : 'beinleumi';
  const username = await ask(`${inst} username: `);
  const password = await askHidden(`${inst} password (hidden): `);
  await vault.set(`creds:${inst}`, JSON.stringify({ username, password }));
  const key = await getDbKey(true);
  Store.open({ path: dbPath(), key }).close();
  console.log(`✓ Connected ${inst}. Credentials stored in your OS keychain.`);
  console.log('  Run `npm run sync`. Connect another institution by running connect again.');
}
```
(Migration: the existing Beinleumi creds are under key `beinleumi`. In `sync`, read `creds:<inst>` first, then fall back to the legacy `beinleumi` key for Beinleumi so the user needn't re-connect.)

- [ ] **Step 2: Generalise `sync`** to loop connected institutions, dispatch to the right adapter, assign categories, upsert:
```ts
import { scrapeCal } from './cal.js';
import { assignCategory } from './categorize.js';

async function sync(): Promise<void> {
  const headless = !!process.env.KESEF_HEADLESS, debug = !!process.env.KESEF_DEBUG;
  const overrides = loadOverrides();
  const common = { now: todayISO(), showBrowser: !headless, verbose: debug,
    failureScreenshotPath: debug ? join(kesefDir(), 'last-failure.png') : undefined } as const;

  const insts: Array<'beinleumi' | 'cal'> = [];
  for (const inst of ['beinleumi', 'cal'] as const) {
    if ((await vault.get(`creds:${inst}`)) || (inst === 'beinleumi' && await vault.get('beinleumi'))) insts.push(inst);
  }
  if (insts.length === 0) { console.error('Nothing connected — run `npm run connect`.'); process.exit(1); }
  if (!headless) console.log('(a browser window will open for each login, then close)');

  const key = await getDbKey(false);
  const store = Store.open({ path: dbPath(), key });
  let added = 0;
  for (const inst of insts) {
    const raw = (await vault.get(`creds:${inst}`)) ?? (await vault.get('beinleumi'))!;
    let creds: { username: string; password: string };
    try { creds = JSON.parse(raw); } catch { console.error(`${inst}: stored credentials corrupt — re-run connect.`); continue; }
    console.log(`Logging in to ${inst}…`);
    const res = inst === 'cal' ? await scrapeCal(creds, common) : await scrapeBeinleumi(creds, common);
    if (!res.ok) { console.error(`✗ ${inst} failed: ${res.errorType ?? ''} ${res.errorMessage ?? ''}`.trim()); continue; }
    const { accounts, transactions, snapshots } = res.data!;
    for (const t of transactions) t.category = assignCategory(t, overrides);
    for (const a of accounts) store.upsertAccount(a);
    for (const t of transactions) store.upsertTransaction(t);
    for (const s of snapshots) store.upsertBalanceSnapshot(s);
    console.log(`  ✓ ${inst}: ${accounts.length} account(s), ${transactions.length} transaction(s).`);
    added += transactions.length;
  }
  console.log(`Stored total: ${store.countTransactions()} transactions across ${store.countAccounts()} accounts.`);
  store.close();
}
```
(Remove the old single-institution sync body. Keep `scrapeBeinleumi` import.)

- [ ] **Step 3: `list` command** — inspect stored transactions (local; helps refine Cal categories):
```ts
async function list(): Promise<void> {
  const key = await getDbKey(false);
  const store = Store.open({ path: dbPath(), key });
  const txns = store.allTransactions().slice(-50); // last 50 by date
  for (const t of txns) {
    const amt = `${t.amount < 0 ? '−' : '+'}₪${Math.abs(t.amount).toLocaleString('en-US')}`.padStart(12);
    console.log(`${t.date}  ${amt}  ${(t.category ?? '?').padEnd(13)} ${t.rawCategory ? `[${t.rawCategory}] ` : ''}${t.description}`);
  }
  console.log(`(${store.countTransactions()} total; showing last ${txns.length})`);
  store.close();
}
```

- [ ] **Step 4: Register + scripts.** Dispatch map:
```ts
const cmds: Record<string, () => Promise<void>> = { connect, sync, status, categorize: recategorize, 'add-balance': addBalance, list };
```
Root `package.json` add: `"list": "tsx packages/ingestion/src/cli.ts list"`.

- [ ] **Step 5: Verify** — `npm run typecheck` clean; `npm test` green. Smoke (no creds): `npm run list` prints the stored Beinleumi transactions with their categories; `npm run status` still works. Do NOT commit.

---

## Verification (end of Phase 2c)
- `npm test` green (map+cal+cardCategory+assignCategory + all prior); `npm run typecheck` clean.
- **User-run:** `npm run connect` → choose `cal` → enter Cal creds; `npm run sync` (visible browser, logs into both Beinleumi + Cal); `npm run list` shows Cal transactions with real `[branchCodeDesc]` categories mapped to buckets. The legal-name cases (ל.ל אחזקות) now categorise via the card network.
- After seeing real Cal `branchCodeDesc` values in `list`, refine `cardCategory.ts` (and add user overrides) so coverage climbs.

## Out of scope / tracked
- Tier-3 external entity resolution (registry/maps) — deferred (user chose local-only).
- Other card issuers; IBI scraping research; Phase-1 store-hardening — still tracked.
