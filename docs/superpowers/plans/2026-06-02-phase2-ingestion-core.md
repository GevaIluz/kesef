# Phase 2 (core slice): Beinleumi connect + sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A secure local CLI that lets Guy (and his partner, separately) log in to **Beinleumi**, pull
transactions into the **encrypted** kesef store, and see what landed — without their bank password ever
leaving their machine or entering any chat/log.

**Architecture:** New workspace package `@kesef/ingestion` depending on `@kesef/core`. A pure, fully-tested
**mapper** converts `israeli-bank-scrapers` results → our domain types. A thin **Beinleumi adapter** wraps
the real scraper behind an injectable factory (so the mapper/flow is unit-tested with fixtures; the real
network login is user-verified). A small **CLI** (`connect` / `sync` / `status`) wires the OS keychain
(creds + DB key + OTP token) to the encrypted `Store`. Run via `tsx` (no build step).

**Tech Stack:** `israeli-bank-scrapers` (MIT, bundles Puppeteer+Chromium), `tsx` (TS runner), Node ≥22.12
(have 24), `@kesef/core` (crypto/vault/store from Phase 1), Node `crypto` for ids/keys.

**Security invariants (non-negotiable):**
- Bank username/password are read via a **hidden local prompt**, stored only in the **OS keychain**, never
  printed, logged, committed, or returned in any tool output.
- The DB key is a random 32 bytes in the keychain; the `.db` is SQLCipher-encrypted at rest (Phase 1).
- `.gitignore` already excludes `*.db`, `.env*`, keys. No fixture may contain a real credential.

---

## File structure

```
packages/ingestion/
├── package.json            # @kesef/ingestion → deps: @kesef/core, israeli-bank-scrapers
├── tsconfig.json
└── src/
    ├── map.ts              # pure: ScrapeResult → {accounts, transactions, snapshots}  (TESTED)
    ├── txid.ts             # deterministic transaction id  (TESTED)
    ├── beinleumi.ts        # adapter: wraps createScraper behind an injectable factory
    ├── paths.ts            # ~/.kesef dir + db path helpers
    ├── prompt.ts           # hidden stdin prompt (password) + visible prompt (OTP)
    └── cli.ts              # connect | sync | status
packages/core/src/store.ts  # MODIFY: add upsertTransaction, upsertBalanceSnapshot, counts, lastSyncAt
test/ (in ingestion)
    ├── txid.test.ts
    └── map.test.ts
```

Root `package.json` MODIFY: add scripts `connect`/`sync`/`status` (run `tsx packages/ingestion/src/cli.ts …`)
and devDependency `tsx`.

---

## Task 1: Scaffold `@kesef/ingestion` + install dependencies

**Files:** create `packages/ingestion/package.json`, `packages/ingestion/tsconfig.json`; modify root `package.json`.

- [ ] **Step 1: Create the package files**

`packages/ingestion/package.json`:
```json
{
  "name": "@kesef/ingestion",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "dependencies": { "@kesef/core": "*" }
}
```
`packages/ingestion/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

- [ ] **Step 2: Install deps** (from repo root)

Run: `npm install israeli-bank-scrapers -w @kesef/ingestion` then `npm install -D tsx`.
Expected: installs; Puppeteer downloads Chromium (~150 MB, one-time). If Chromium download fails, report
BLOCKED with the error (do not substitute a different scraper).

- [ ] **Step 3: License check (org policy — no GPL)**

Run: `node -p "require('./node_modules/israeli-bank-scrapers/package.json').license"` (expect MIT) and
`node -p "require('./node_modules/puppeteer/package.json').license"` (expect Apache-2.0). Then scan:
`npm ls --all --json 2>/dev/null | grep -i gpl` → expect no matches. Report the three results.

- [ ] **Step 4: Confirm the real scraper API against installed types** (do this before coding the adapter)

Open `node_modules/israeli-bank-scrapers/lib/` typings and record the EXACT identifiers, because this plan's
adapter must match the installed version:
- the `CompanyTypes` member for Beinleumi (e.g. `CompanyTypes.beinleumi`),
- `ScraperOptions` fields (`companyId`, `startDate`, `combineInstallments`, `showBrowser`, `timeout`, `verbose`),
- the Beinleumi credentials type (expected `{ username, password }`) and any OTP fields (`otpCodeRetriever`,
  `otpLongTermToken` / `persistentOtpToken`),
- the result type (`success`, `accounts[].accountNumber`, `accounts[].balance`, `accounts[].txns[]` with
  `date`, `chargedAmount`, `originalAmount`, `originalCurrency`, `description`, `status`, `type`,
  `identifier`, `installments`), and where a persistent OTP token surfaces.
Report the actual signatures. Implement the adapter (Task 4) against THESE, not against assumptions.

- [ ] **Step 5: Verify nothing broke**

Run: `npm test && npm run typecheck` (Phase-1 suite still green; new empty package doesn't break typecheck).
Do NOT commit (controller commits).

---

## Task 2: Deterministic transaction id (`txid.ts`) — TDD

A scrape returns the same transaction every run; we need a stable id so re-sync never duplicates.

**Files:** create `packages/ingestion/src/txid.ts`, `packages/ingestion/test/txid.test.ts`.

- [ ] **Step 1: Failing test** — `test/txid.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { txId } from '../src/txid';

const base = { accountNumber: '12-345-6789', date: '2026-05-01', chargedAmount: -42.5, description: 'שופרסל', identifier: 0 };

describe('txId', () => {
  it('is stable for identical inputs', () => {
    expect(txId(base)).toBe(txId({ ...base }));
  });
  it('changes when any field changes', () => {
    expect(txId(base)).not.toBe(txId({ ...base, chargedAmount: -43 }));
    expect(txId(base)).not.toBe(txId({ ...base, date: '2026-05-02' }));
    expect(txId(base)).not.toBe(txId({ ...base, accountNumber: 'x' }));
  });
  it('uses the bank identifier when present to disambiguate same-day same-amount txns', () => {
    expect(txId({ ...base, identifier: 1 })).not.toBe(txId({ ...base, identifier: 2 }));
  });
});
```

- [ ] **Step 2: Run → fails** (`npm test -- txid`).

- [ ] **Step 3: Implement** — `src/txid.ts`:
```ts
import { createHash } from 'node:crypto';

export interface TxIdParts {
  accountNumber: string;
  date: string;            // ISO
  chargedAmount: number;
  description: string;
  identifier?: number | string | null;
}

/** Deterministic, collision-resistant id for a bank transaction (stable across re-syncs). */
export function txId(p: TxIdParts): string {
  const key = [p.accountNumber, p.date, p.chargedAmount, p.description, p.identifier ?? ''].join('|');
  return createHash('sha256').update(key).digest('hex').slice(0, 24);
}
```

- [ ] **Step 4: Run → passes.** Do NOT commit.

---

## Task 3: Store extension for idempotent sync — TDD

`insertTransaction` (Phase 1) throws on duplicate PK; sync must be re-runnable. Add upserts + read helpers.

**Files:** modify `packages/core/src/store.ts`; create `packages/core/test/store-sync.test.ts`.

- [ ] **Step 1: Failing test** — `packages/core/test/store-sync.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/index';
import type { Account, Transaction, BalanceSnapshot } from '../src/index';

let dir: string;
const newDb = () => { dir = mkdtempSync(join(tmpdir(), 'kesef-')); return join(dir, 'test.db'); };
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

const a: Account = { id: 'a1', institution: 'beinleumi', type: 'bank', displayName: 'עו"ש', currency: 'ILS', shareable: false };
const t: Transaction = { id: 't1', accountId: 'a1', date: '2026-05-01', amount: -42.5, description: 'x', shareable: false };

describe('Store sync helpers', () => {
  it('upsertTransaction is idempotent and updates status/amount in place', () => {
    const s = Store.open({ path: newDb(), key: 'pw' });
    s.upsertAccount(a);
    s.upsertTransaction({ ...t, category: 'groceries' });
    s.upsertTransaction({ ...t, amount: -50, category: 'groceries' }); // same id, changed amount
    const rows = s.listTransactions('a1');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe(-50);
    expect(s.countTransactions()).toBe(1);
    s.close();
  });
  it('upsertBalanceSnapshot records balances and countAccounts works', () => {
    const s = Store.open({ path: newDb(), key: 'pw' });
    s.upsertAccount(a);
    const snap: BalanceSnapshot = { id: 's1', accountId: 'a1', date: '2026-05-01', balance: 1000 };
    s.upsertBalanceSnapshot(snap);
    s.upsertBalanceSnapshot({ ...snap, balance: 1200 }); // same id → update
    expect(s.countAccounts()).toBe(1);
    s.close();
  });
});
```

- [ ] **Step 2: Run → fails** (`npm test -- store-sync`).

- [ ] **Step 3: Implement** — add to `Store` in `packages/core/src/store.ts` (place beside the existing methods):
```ts
  upsertTransaction(t: Transaction): void {
    this.db.prepare(
      `INSERT INTO transactions (id, account_id, date, amount, description, raw_category, category, shareable)
       VALUES (@id, @accountId, @date, @amount, @description, @rawCategory, @category, @shareable)
       ON CONFLICT(id) DO UPDATE SET
         account_id=@accountId, date=@date, amount=@amount, description=@description,
         raw_category=@rawCategory, category=@category, shareable=@shareable`
    ).run({
      id: t.id, accountId: t.accountId, date: t.date, amount: t.amount,
      description: t.description, rawCategory: t.rawCategory ?? null,
      category: t.category ?? null, shareable: t.shareable == null ? null : t.shareable ? 1 : 0,
    });
  }

  upsertBalanceSnapshot(s: BalanceSnapshot): void {
    this.db.prepare(
      `INSERT INTO balance_snapshots (id, account_id, date, balance)
       VALUES (@id, @accountId, @date, @balance)
       ON CONFLICT(id) DO UPDATE SET account_id=@accountId, date=@date, balance=@balance`
    ).run({ id: s.id, accountId: s.accountId, date: s.date, balance: s.balance });
  }

  countTransactions(): number {
    return (this.db.prepare('SELECT count(*) c FROM transactions').get() as { c: number }).c;
  }
  countAccounts(): number {
    return (this.db.prepare('SELECT count(*) c FROM accounts').get() as { c: number }).c;
  }
```
Add `import type { ..., BalanceSnapshot } from './types';` (extend the existing type import).

- [ ] **Step 4: Run → passes.** Then `npm test && npm run typecheck` both green. Do NOT commit.

---

## Task 4: Beinleumi adapter (`beinleumi.ts` + `map.ts`)

Pure mapper is fully tested; the adapter wires the real scraper behind an injectable factory.

**Files:** create `packages/ingestion/src/map.ts`, `packages/ingestion/src/beinleumi.ts`, `packages/ingestion/test/map.test.ts`, `packages/ingestion/src/index.ts`.

- [ ] **Step 1: Failing test for the mapper** — `test/map.test.ts` (fixture mimics the documented result shape; adjust field names if Task 1 Step 4 found differences):
```ts
import { describe, it, expect } from 'vitest';
import { mapScrapeResult } from '../src/map';

const result = {
  success: true,
  accounts: [{
    accountNumber: '410-12345',
    balance: 42300,
    txns: [
      { type: 'normal', identifier: 11, date: '2026-05-01T00:00:00Z', chargedAmount: -342.8, originalAmount: -342.8, originalCurrency: 'ILS', description: 'שופרסל', status: 'completed' },
      { type: 'normal', identifier: 12, date: '2026-05-02T00:00:00Z', chargedAmount: 24000, originalAmount: 24000, originalCurrency: 'ILS', description: 'משכורת', status: 'completed' },
    ],
  }],
};

describe('mapScrapeResult', () => {
  const out = mapScrapeResult(result as any, { now: '2026-05-03' });
  it('produces one account with a beinleumi institution', () => {
    expect(out.accounts).toHaveLength(1);
    expect(out.accounts[0]!.institution).toBe('beinleumi');
    expect(out.accounts[0]!.type).toBe('bank');
    expect(out.accounts[0]!.currency).toBe('ILS');
    expect(out.accounts[0]!.shareable).toBe(false);
  });
  it('maps txns with signed amounts and ISO date (date-only)', () => {
    expect(out.transactions).toHaveLength(2);
    const groceries = out.transactions.find(t => t.description === 'שופרסל')!;
    expect(groceries.amount).toBe(-342.8);
    expect(groceries.date).toBe('2026-05-01');
    expect(groceries.accountId).toBe(out.accounts[0]!.id);
  });
  it('emits a balance snapshot dated now', () => {
    expect(out.snapshots).toHaveLength(1);
    expect(out.snapshots[0]!.balance).toBe(42300);
    expect(out.snapshots[0]!.date).toBe('2026-05-03');
  });
});
```

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement the mapper** — `src/map.ts`:
```ts
import type { Account, Transaction, BalanceSnapshot } from '@kesef/core';
import { txId } from './txid';

// Minimal structural view of israeli-bank-scrapers output (verify against installed types).
export interface ScrapeAccount { accountNumber: string; balance?: number; txns: ScrapeTxn[]; }
export interface ScrapeTxn {
  date: string; chargedAmount: number; description: string; status?: string;
  identifier?: number | string | null;
}
export interface ScrapeResult { success?: boolean; accounts?: ScrapeAccount[]; }

const ymd = (iso: string): string => iso.slice(0, 10);
/** Stable per-bank-account id (kesef account id), independent of run. */
const acctId = (accountNumber: string): string => 'beinleumi:' + accountNumber;

export interface MapOptions { now: string; } // ISO date for the balance snapshot

export function mapScrapeResult(r: ScrapeResult, opts: MapOptions): {
  accounts: Account[]; transactions: Transaction[]; snapshots: BalanceSnapshot[];
} {
  const accounts: Account[] = []; const transactions: Transaction[] = []; const snapshots: BalanceSnapshot[] = [];
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
```

- [ ] **Step 4: Run → passes** (`npm test -- map`).

- [ ] **Step 5: Implement the adapter** — `src/beinleumi.ts`. Use the EXACT identifiers found in Task 1 Step 4.
```ts
import { createScraper, CompanyTypes } from 'israeli-bank-scrapers';
import { mapScrapeResult, type ScrapeResult } from './map';

// Beinleumi (v6.7.5) authenticates with username + password only — NO OTP (verified in Task 1 recon).
export interface BeinleumiCreds { username: string; password: string; }
export interface ScrapeDeps {
  scraperFactory?: typeof createScraper; // injectable for tests; defaults to the real library
  startDate?: Date;
  now: string;
}

export interface ScrapeOutcome {
  ok: boolean; errorType?: string; errorMessage?: string;
  data?: ReturnType<typeof mapScrapeResult>;
}

export async function scrapeBeinleumi(creds: BeinleumiCreds, deps: ScrapeDeps): Promise<ScrapeOutcome> {
  const factory = deps.scraperFactory ?? createScraper;
  const startDate = deps.startDate ?? new Date(Date.now() - 1000 * 60 * 60 * 24 * 90); // ~90 days
  const scraper = factory({ companyId: CompanyTypes.beinleumi, startDate, combineInstallments: false, showBrowser: false });
  const result = await scraper.scrape(creds) as ScrapeResult & { errorType?: string; errorMessage?: string };
  if (!result.success) return { ok: false, errorType: result.errorType, errorMessage: result.errorMessage };
  return { ok: true, data: mapScrapeResult(result, { now: deps.now }) };
}
```
`src/index.ts`: `export * from './map'; export * from './txid'; export * from './beinleumi';`

- [ ] **Step 6: Typecheck** — `npm run typecheck`. If the installed scraper's option/credential/OTP names
differ from the above, FIX `beinleumi.ts` to match the real types and note the differences. Do NOT commit.

> The real Beinleumi login is exercised by the CLI in Task 5 and verified by the user (creds + SMS required).

---

## Task 5: CLI — `connect` / `sync` / `status`

**Files:** create `packages/ingestion/src/paths.ts`, `src/prompt.ts`, `src/cli.ts`; modify root `package.json`.

- [ ] **Step 1: Paths + prompt helpers**

`src/paths.ts`:
```ts
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
export function kesefDir(): string { const d = join(homedir(), '.kesef'); mkdirSync(d, { recursive: true }); return d; }
export function dbPath(): string { return join(kesefDir(), 'kesef.db'); }
```
`src/prompt.ts` — hidden password prompt + visible line prompt (no deps, raw stdin):
```ts
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline';

export function ask(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  return new Promise(res => rl.question(question, a => { rl.close(); res(a.trim()); }));
}

/** Prompt without echoing input (for passwords). */
export function askHidden(question: string): Promise<string> {
  return new Promise(res => {
    stdout.write(question);
    stdin.resume(); stdin.setRawMode?.(true);
    let buf = '';
    const onData = (d: Buffer) => {
      const s = d.toString('utf8');
      if (s === '\n' || s === '\r' || s === '') {
        stdin.setRawMode?.(false); stdin.pause(); stdin.off('data', onData); stdout.write('\n'); res(buf);
      } else if (s === '') { process.exit(1); // Ctrl-C
      } else if (s === '' || s === '\b') { buf = buf.slice(0, -1);
      } else { buf += s; }
    };
    stdin.on('data', onData);
  });
}
```

> **Use this exact `askHidden` implementation** (the snippet above had corrupted control characters).
> No literal control chars — compare numeric byte codes. (Passwords are assumed ASCII; fine for this use.)
> ```ts
> export function askHidden(question: string): Promise<string> {
>   return new Promise(res => {
>     stdout.write(question);
>     stdin.resume(); stdin.setRawMode?.(true);
>     let buf = '';
>     const onData = (d: Buffer) => {
>       for (const byte of d) {
>         if (byte === 3) { stdout.write('\n'); process.exit(1); }          // Ctrl-C
>         if (byte === 13 || byte === 10) {                                 // Enter
>           stdin.setRawMode?.(false); stdin.pause(); stdin.off('data', onData); stdout.write('\n'); return res(buf);
>         }
>         if (byte === 127 || byte === 8) buf = buf.slice(0, -1);           // Backspace
>         else buf += String.fromCharCode(byte);
>       }
>     };
>     stdin.on('data', onData);
>   });
> }
> ```

- [ ] **Step 2: CLI** — `src/cli.ts`. Keychain accounts under service `kesef`:
`beinleumi` (JSON `{username,password}`), `db-key` (hex).
```ts
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { KeyringVault, Store } from '@kesef/core';
import { dbPath } from './paths';
import { ask, askHidden } from './prompt';
import { scrapeBeinleumi } from './beinleumi';

const vault = new KeyringVault('kesef');
const todayISO = () => new Date().toISOString().slice(0, 10);

async function getDbKey(create: boolean): Promise<string> {
  let k = await vault.get('db-key');
  if (!k && create) { k = randomBytes(32).toString('hex'); await vault.set('db-key', k); }
  if (!k) throw new Error('No DB key — run `npm run connect` first.');
  return k;
}

async function connect(): Promise<void> {
  const username = await ask('Beinleumi username: ');
  const password = await askHidden('Beinleumi password (hidden): ');
  await vault.set('beinleumi', JSON.stringify({ username, password }));
  const key = await getDbKey(true);
  Store.open({ path: dbPath(), key }).close(); // initializes the encrypted DB
  console.log('✓ Connected. Credentials stored in your OS keychain; encrypted DB at ~/.kesef/kesef.db');
  console.log('  Next: `npm run sync`');
}

async function sync(): Promise<void> {
  const raw = await vault.get('beinleumi');
  if (!raw) { console.error('Not connected — run `npm run connect`.'); process.exit(1); }
  const { username, password } = JSON.parse(raw);
  console.log('Logging in to Beinleumi…');
  const res = await scrapeBeinleumi({ username, password }, { now: todayISO() });
  if (!res.ok) { console.error(`✗ Login failed: ${res.errorType ?? ''} ${res.errorMessage ?? ''}`); process.exit(1); }
  const key = await getDbKey(false);
  const store = Store.open({ path: dbPath(), key });
  const { accounts, transactions, snapshots } = res.data!;
  for (const a of accounts) store.upsertAccount(a);
  for (const t of transactions) store.upsertTransaction(t);
  for (const s of snapshots) store.upsertBalanceSnapshot(s);
  console.log(`✓ Synced ${accounts.length} account(s), ${transactions.length} transaction(s).`);
  console.log(`  Stored total: ${store.countTransactions()} transactions across ${store.countAccounts()} accounts.`);
  store.close();
}

async function status(): Promise<void> {
  const key = await getDbKey(false);
  const store = Store.open({ path: dbPath(), key });
  console.log(`${store.countAccounts()} account(s), ${store.countTransactions()} transaction(s) in ~/.kesef/kesef.db`);
  store.close();
}

const cmd = process.argv[2];
({ connect, sync, status }[cmd as 'connect' | 'sync' | 'status'] ?? (() => {
  console.error('usage: connect | sync | status'); process.exit(1);
}))().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
```
> Beinleumi needs no OTP (verified v6.7.5). If a real sync ever returns `TWO_FACTOR_RETRIEVER_MISSING`, revisit.

- [ ] **Step 3: Root scripts** — add to root `package.json` `"scripts"`:
```json
"connect": "tsx packages/ingestion/src/cli.ts connect",
"sync": "tsx packages/ingestion/src/cli.ts sync",
"status": "tsx packages/ingestion/src/cli.ts status"
```

- [ ] **Step 4: Typecheck** — `npm run typecheck` clean. `npm test` (Phase-1 + new unit tests) green. Do NOT commit.

- [ ] **Step 5: USER verification (manual — cannot be automated; requires real creds + SMS)**

Hand these to Guy to run himself; the agent must NOT ask for or handle the credentials:
1. `npm run connect` → enter Beinleumi username + password (password input is hidden).
2. `npm run sync` → if prompted, type the SMS code. Expect `✓ Synced N account(s), M transaction(s).`
3. `npm run status` → shows stored counts.
4. Confirm `~/.kesef/kesef.db` exists and is ciphertext: `head -c 16 ~/.kesef/kesef.db | xxd` shows non-text
   (no `SQLite format 3`). The agent can run only step 4 (no secrets involved).

---

## Verification (end of Phase 2 core)

- `npm test` green (txid, map, store-sync + all Phase-1 suites); `npm run typecheck` clean; `npm audit` clean
  of non-dev criticals; license check passed (no GPL).
- Unit-level: scrape-result fixtures map correctly; re-sync is idempotent (upsert).
- End-to-end: **user** confirms `connect` → `sync` pulls real Beinleumi transactions into the encrypted DB
  and `status` shows them; DB file is ciphertext on disk.

## Out of scope (next slices)
- Manual / CSV import for **IBI** and **pension** → Phase 2b.
- **Categorization** engine (merchant → CategoryCode) → Phase 2b.
- Scheduling/auto-sync, multiple credit-card issuers, partner-vs-me profile separation in the CLI → later.
- The Phase-1 store-hardening follow-ups (user_version migrations, cipher_compatibility pin) still tracked.

**Carried from the Task 5 security review (track-for-later, not blocking):**
- `askHidden` is single-byte ASCII only — fine for Beinleumi creds; revisit if non-ASCII passwords needed.
- Wrap the `sync` upsert loops in one `better-sqlite3` transaction once row counts grow (atomicity + speed).
- Make `ScrapeOutcome` a discriminated union (`{ok:true;data} | {ok:false;errorType;errorMessage}`) to drop the `!`.
```
