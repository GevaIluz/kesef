# Phase 1: Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `kesef` TypeScript monorepo with a locale-neutral domain model, audited
AES-256-GCM encryption helpers, a swappable secret vault, and an encrypted-at-rest SQLite store — the
secure foundation every later phase builds on.

**Architecture:** A single npm-workspaces monorepo. All shared logic lives in `packages/core`: domain
types, crypto (Node built-in `crypto`, no third-party crypto deps to audit), a `SecretVault` interface
with an in-memory implementation for tests + a keychain-backed implementation for real use, and a `Store`
class wrapping an encrypted SQLite database (`better-sqlite3-multiple-ciphers`, SQLCipher/AES-256). The
DB holds only locale-neutral data (numbers, ISO-8601 dates, currency/category codes) so the bilingual UI
can localize freely later.

**Tech Stack:** Node 24, npm workspaces, TypeScript (strict), Vitest, `better-sqlite3-multiple-ciphers`,
`@napi-rs/keyring` (OS keychain), Node `crypto` (AES-256-GCM + scrypt).

---

## File Structure

```
kesef/
├── package.json                      # workspaces root, shared scripts
├── tsconfig.base.json                # strict TS config, extended by packages
├── vitest.config.ts                  # workspace test runner
├── .gitignore
└── packages/
    └── core/
        ├── package.json
        ├── tsconfig.json
        └── src/
            ├── types.ts              # domain model (Account, Transaction, ...)
            ├── crypto.ts             # deriveKey / encrypt / decrypt
            ├── vault.ts              # SecretVault interface + InMemoryVault + KeyringVault
            ├── store.ts              # encrypted SQLite Store
            ├── schema.sql            # DDL applied on store open
            └── index.ts              # public exports
        └── test/
            ├── crypto.test.ts
            ├── vault.test.ts
            └── store.test.ts
```

**Security note (org-policy aligned):** no secrets committed; no plaintext credentials at rest; AES-256 at
rest; encryption uses only the audited Node `crypto` module. `.gitignore` must exclude `*.db`, `*.sqlite`,
`.env*`, `*.pem`, `*.key`.

---

## Task 1: Monorepo scaffold + tooling

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `vitest.config.ts`, `.gitignore`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`, `packages/core/test/smoke.test.ts`

- [ ] **Step 1: Write the failing smoke test**

`packages/core/test/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { VERSION } from '../src/index';

describe('core package', () => {
  it('exposes a version string', () => {
    expect(VERSION).toBe('0.1.0');
  });
});
```

- [ ] **Step 2: Create the scaffold files**

`package.json`:
```json
{
  "name": "kesef",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"],
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b --pretty"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.0.0"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "verbatimModuleSyntax": true
  }
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['packages/**/test/**/*.test.ts'] } });
```

`.gitignore`:
```
node_modules/
dist/
*.db
*.sqlite
*.sqlite3
.env*
*.pem
*.key
.DS_Store
```

`packages/core/package.json`:
```json
{
  "name": "@kesef/core",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "exports": { ".": "./src/index.ts" }
}
```

`packages/core/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`packages/core/src/index.ts`:
```ts
export const VERSION = '0.1.0';
```

- [ ] **Step 3: Install and run the test (expect PASS after install)**

Run: `cd ~/projects/kesef && npm install && npm test`
Expected: install succeeds; `smoke.test.ts` PASSES (1 test).

- [ ] **Step 4: Initialize git and commit**

```bash
cd ~/projects/kesef
git init
git add -A
git commit -m "chore: scaffold kesef monorepo with core package and vitest"
```

---

## Task 2: Locale-neutral domain model

**Files:**
- Create: `packages/core/src/types.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/types.test.ts`

- [ ] **Step 1: Write the failing test** (a type-level + runtime guard test)

`packages/core/test/types.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { isExpense, type Transaction } from '../src/index';

const tx: Transaction = {
  id: 't1', accountId: 'a1', date: '2026-05-01',
  amount: -42.5, description: 'Coffee', shareable: false,
};

describe('domain model', () => {
  it('treats negative amounts as expenses', () => {
    expect(isExpense(tx)).toBe(true);
    expect(isExpense({ ...tx, amount: 100 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- types`
Expected: FAIL — `isExpense` / `Transaction` not exported.

- [ ] **Step 3: Implement the types**

`packages/core/src/types.ts`:
```ts
// All data is locale-neutral: numbers, ISO-8601 date strings, and stable codes.
// The bilingual (he/en) UI localizes these at render time — never store localized text here.

export type Currency = 'ILS';
export type AccountType = 'bank' | 'credit_card' | 'investment' | 'pension';

/** Stable category codes; UI maps these to he/en labels. */
export type CategoryCode =
  | 'groceries' | 'dining' | 'transport' | 'housing' | 'utilities'
  | 'health' | 'shopping' | 'entertainment' | 'income' | 'transfer'
  | 'savings' | 'investment' | 'fees' | 'other';

export interface Account {
  id: string;
  institution: 'beinleumi' | 'ibi' | 'manual';
  type: AccountType;
  displayName: string;        // user-entered; shown as-is in either language
  currency: Currency;
  shareable: boolean;         // per-item couple-sharing flag (default false)
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
  targetDate: string;         // ISO-8601
  currentAmount: number;
  shareable: boolean;
}

export function isExpense(tx: Transaction): boolean {
  return tx.amount < 0;
}
```

`packages/core/src/index.ts` (append):
```ts
export const VERSION = '0.1.0';
export * from './types';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- types`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/index.ts packages/core/test/types.test.ts
git commit -m "feat(core): add locale-neutral domain model"
```

---

## Task 3: AES-256-GCM crypto helpers

**Files:**
- Create: `packages/core/src/crypto.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/crypto.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/core/test/crypto.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { deriveKey, encrypt, decrypt } from '../src/index';

describe('crypto', () => {
  const key = deriveKey('correct horse battery staple', Buffer.alloc(16, 1));

  it('round-trips plaintext', () => {
    const blob = encrypt('hello ₪ שלום', key);
    expect(decrypt(blob, key)).toBe('hello ₪ שלום');
  });

  it('produces a different ciphertext each call (random IV)', () => {
    expect(encrypt('x', key).ciphertext).not.toBe(encrypt('x', key).ciphertext);
  });

  it('fails to decrypt with the wrong key', () => {
    const blob = encrypt('secret', key);
    const wrong = deriveKey('wrong', Buffer.alloc(16, 1));
    expect(() => decrypt(blob, wrong)).toThrow();
  });

  it('derives a 32-byte key', () => {
    expect(key).toHaveLength(32);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- crypto`
Expected: FAIL — `deriveKey`/`encrypt`/`decrypt` not exported.

- [ ] **Step 3: Implement crypto**

`packages/core/src/crypto.ts`:
```ts
import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

export interface EncryptedBlob {
  iv: string;          // base64
  tag: string;         // base64 (GCM auth tag)
  ciphertext: string;  // base64
}

/** Derive a 32-byte key from a passphrase + salt using scrypt. */
export function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32);
}

export function encrypt(plaintext: string, key: Buffer): EncryptedBlob {
  const iv = randomBytes(12); // 96-bit nonce, recommended for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ct.toString('base64'),
  };
}

export function decrypt(blob: EncryptedBlob, key: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(blob.ciphertext, 'base64')),
    decipher.final(), // throws on auth-tag mismatch (wrong key / tampering)
  ]);
  return pt.toString('utf8');
}
```

`packages/core/src/index.ts` (append):
```ts
export * from './crypto';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- crypto`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/crypto.ts packages/core/src/index.ts packages/core/test/crypto.test.ts
git commit -m "feat(core): add AES-256-GCM encryption helpers"
```

---

## Task 4: Secret vault (interface + in-memory + keychain backend)

**Files:**
- Create: `packages/core/src/vault.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/package.json`
- Test: `packages/core/test/vault.test.ts`

- [ ] **Step 1: Write the failing tests** (against the in-memory implementation)

`packages/core/test/vault.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryVault, type SecretVault } from '../src/index';

describe('SecretVault (in-memory)', () => {
  let vault: SecretVault;
  beforeEach(() => { vault = new InMemoryVault(); });

  it('returns null for a missing secret', async () => {
    expect(await vault.get('beinleumi:guy')).toBeNull();
  });

  it('stores and retrieves a secret', async () => {
    await vault.set('beinleumi:guy', 's3cret');
    expect(await vault.get('beinleumi:guy')).toBe('s3cret');
  });

  it('overwrites an existing secret', async () => {
    await vault.set('k', 'a');
    await vault.set('k', 'b');
    expect(await vault.get('k')).toBe('b');
  });

  it('deletes a secret', async () => {
    await vault.set('k', 'a');
    await vault.delete('k');
    expect(await vault.get('k')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- vault`
Expected: FAIL — `InMemoryVault` not exported.

- [ ] **Step 3: Install the keychain backend dependency**

Run: `cd ~/projects/kesef && npm install @napi-rs/keyring@^1.1.0 -w @kesef/core`
Expected: installs into `packages/core`.

- [ ] **Step 4: Implement the vault**

`packages/core/src/vault.ts`:
```ts
import { Entry } from '@napi-rs/keyring';

/** Read/write secrets (e.g. bank credentials) by an opaque account key. */
export interface SecretVault {
  get(account: string): Promise<string | null>;
  set(account: string, secret: string): Promise<void>;
  delete(account: string): Promise<void>;
}

/** Test/dev backend. Never persists — secrets vanish with the process. */
export class InMemoryVault implements SecretVault {
  private store = new Map<string, string>();
  async get(account: string) { return this.store.has(account) ? this.store.get(account)! : null; }
  async set(account: string, secret: string) { this.store.set(account, secret); }
  async delete(account: string) { this.store.delete(account); }
}

/** Production backend: OS keychain (macOS Keychain / Windows Credential Manager / libsecret). */
export class KeyringVault implements SecretVault {
  constructor(private service = 'kesef') {}
  private entry(account: string) { return new Entry(this.service, account); }
  async get(account: string) {
    try { return this.entry(account).getPassword(); }
    catch { return null; } // keyring throws when the entry does not exist
  }
  async set(account: string, secret: string) { this.entry(account).setPassword(secret); }
  async delete(account: string) { try { this.entry(account).deletePassword(); } catch { /* absent */ } }
}
```

`packages/core/src/index.ts` (append):
```ts
export * from './vault';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- vault`
Expected: PASS (4 tests). Only `InMemoryVault` is exercised in CI; `KeyringVault` is verified manually below.

- [ ] **Step 6: Manual verification of the keychain backend** (one-time, local)

Run:
```bash
cd ~/projects/kesef
node --input-type=module -e "import {KeyringVault} from './packages/core/src/vault.ts'" 2>/dev/null || \
echo "NOTE: run via a quick vitest scratch test instead (ts import)."
```
Then add a temporary test guarded by an env flag, run it once, confirm the secret appears in macOS Keychain Access under service `kesef`, then delete the temp test. (Documented here so the engineer doesn't commit a test that writes to the real keychain in CI.)

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/vault.ts packages/core/src/index.ts packages/core/test/vault.test.ts packages/core/package.json package-lock.json
git commit -m "feat(core): add SecretVault with in-memory and OS-keychain backends"
```

---

## Task 5: Encrypted-at-rest SQLite store

**Files:**
- Create: `packages/core/src/schema.sql`, `packages/core/src/store.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/package.json`
- Test: `packages/core/test/store.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/core/test/store.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/index';
import type { Account, Transaction } from '../src/index';

let dir: string;
const newDb = () => { dir = mkdtempSync(join(tmpdir(), 'kesef-')); return join(dir, 'test.db'); };
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

const acct: Account = {
  id: 'a1', institution: 'beinleumi', type: 'bank',
  displayName: 'עו"ש', currency: 'ILS', shareable: false,
};
const tx: Transaction = { id: 't1', accountId: 'a1', date: '2026-05-01', amount: -42.5, description: 'Cafe', shareable: false };

describe('Store', () => {
  it('persists and reads back accounts', () => {
    const path = newDb();
    const s = Store.open({ path, key: 'pw' });
    s.upsertAccount(acct);
    expect(s.listAccounts()).toEqual([acct]);
    s.close();
  });

  it('persists transactions across reopen with the same key', () => {
    const path = newDb();
    const s1 = Store.open({ path, key: 'pw' });
    s1.upsertAccount(acct);
    s1.insertTransaction(tx);
    s1.close();
    const s2 = Store.open({ path, key: 'pw' });
    expect(s2.listTransactions('a1')).toEqual([tx]);
    s2.close();
  });

  it('cannot open the database with the wrong key', () => {
    const path = newDb();
    const s = Store.open({ path, key: 'right' });
    s.upsertAccount(acct);
    s.close();
    expect(() => Store.open({ path, key: 'wrong' })).toThrow();
  });

  it('writes ciphertext to disk (no plaintext leaks)', () => {
    const path = newDb();
    const s = Store.open({ path, key: 'pw' });
    s.upsertAccount({ ...acct, displayName: 'SECRET_MARKER_STRING' });
    s.close();
    const raw = readFileSync(path);
    expect(raw.includes(Buffer.from('SECRET_MARKER_STRING'))).toBe(false);
    expect(raw.subarray(0, 16).toString()).not.toBe('SQLite format 3 '); // header is encrypted too
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- store`
Expected: FAIL — `Store` not exported.

- [ ] **Step 3: Install the encrypted SQLite driver**

Run: `cd ~/projects/kesef && npm install better-sqlite3-multiple-ciphers@^11.0.0 -w @kesef/core`
Expected: native module builds and installs into `packages/core`.

- [ ] **Step 4: Write the schema**

`packages/core/src/schema.sql`:
```sql
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
```

- [ ] **Step 5: Implement the store**

`packages/core/src/store.ts`:
```ts
import Database from 'better-sqlite3-multiple-ciphers';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Account, Transaction } from './types';

const SCHEMA = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'schema.sql'), 'utf8');

export interface OpenStoreOptions {
  path: string;
  key: string; // passphrase; applied via SQLCipher PRAGMA key
}

export class Store {
  private constructor(private db: Database.Database) {}

  static open(opts: OpenStoreOptions): Store {
    const db = new Database(opts.path);
    db.pragma("cipher='sqlcipher'"); // AES-256-CBC + HMAC-SHA (matches "AES-256 at rest")
    db.pragma(`key='${opts.key.replace(/'/g, "''")}'`);
    // Force a read so an invalid key fails fast (SQLCipher is lazy otherwise).
    db.exec('SELECT count(*) FROM sqlite_master;'); // throws on wrong key
    db.exec(SCHEMA);
    db.pragma('foreign_keys = ON');
    return new Store(db);
  }

  upsertAccount(a: Account): void {
    this.db.prepare(
      `INSERT INTO accounts (id, institution, type, display_name, currency, shareable)
       VALUES (@id, @institution, @type, @displayName, @currency, @shareable)
       ON CONFLICT(id) DO UPDATE SET
         institution=@institution, type=@type, display_name=@displayName,
         currency=@currency, shareable=@shareable`
    ).run({ ...a, shareable: a.shareable ? 1 : 0 });
  }

  listAccounts(): Account[] {
    return this.db.prepare('SELECT * FROM accounts ORDER BY id').all().map(rowToAccount);
  }

  insertTransaction(t: Transaction): void {
    this.db.prepare(
      `INSERT INTO transactions (id, account_id, date, amount, description, raw_category, category, shareable)
       VALUES (@id, @accountId, @date, @amount, @description, @rawCategory, @category, @shareable)`
    ).run({
      id: t.id, accountId: t.accountId, date: t.date, amount: t.amount,
      description: t.description, rawCategory: t.rawCategory ?? null,
      category: t.category ?? null, shareable: t.shareable == null ? null : t.shareable ? 1 : 0,
    });
  }

  listTransactions(accountId: string): Transaction[] {
    return this.db.prepare('SELECT * FROM transactions WHERE account_id = ? ORDER BY date, id')
      .all(accountId).map(rowToTransaction);
  }

  close(): void { this.db.close(); }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function rowToAccount(r: any): Account {
  return {
    id: r.id, institution: r.institution, type: r.type,
    displayName: r.display_name, currency: r.currency, shareable: !!r.shareable,
  };
}
function rowToTransaction(r: any): Transaction {
  const t: Transaction = {
    id: r.id, accountId: r.account_id, date: r.date,
    amount: r.amount, description: r.description, shareable: r.shareable == null ? undefined : !!r.shareable,
  };
  if (r.raw_category != null) t.rawCategory = r.raw_category;
  if (r.category != null) t.category = r.category;
  return t;
}
```

`packages/core/src/index.ts` (append):
```ts
export * from './store';
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- store`
Expected: PASS (4 tests). The "wrong key" and "ciphertext on disk" tests confirm encryption-at-rest works.

- [ ] **Step 7: Run the full suite + typecheck**

Run: `cd ~/projects/kesef && npm test && npm run typecheck`
Expected: all tests PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/store.ts packages/core/src/schema.sql packages/core/src/index.ts packages/core/package.json package-lock.json packages/core/test/store.test.ts
git commit -m "feat(core): add encrypted-at-rest SQLite store"
```

---

## Verification (end of Phase 1)

- `npm test` → all suites green (smoke, types, crypto, vault, store).
- `npm run typecheck` → clean.
- Encryption-at-rest proven by the store tests: wrong key throws, and no plaintext marker appears in the
  raw `.db` file.
- The keychain backend is verified once manually (Task 4 Step 6) and excluded from CI.

## Out of scope (later phases)

- Beinleumi scraping + IBI/pension manual import → **Phase 2**.
- Categorization engine → **Phase 2**.
- Dashboard, charts, i18n/RTL toggle → **Phase 3**.
- Sharing flags wiring + couple sync → **Phase 4**.
- The `shareable` flags exist in the model now but are not yet acted upon.
