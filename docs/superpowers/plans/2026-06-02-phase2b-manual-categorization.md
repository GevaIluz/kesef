# Phase 2b: Manual balances (IBI + pension) + auto-categorization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. TDD; checkbox steps.

**Goal:** Complete the data picture so the dashboard is meaningful: (1) a Hebrew-aware **categorization**
engine that labels Beinleumi transactions (groceries/dining/transport/…), applied on every sync and via a
re-categorize command, with a user override file; (2) a **manual balance** command to record IBI portfolio
+ pension (+ any manual account) values, feeding net worth + forecasting.

**Architecture:** All in `@kesef/ingestion` + a small `@kesef/core` store read. Categorization is a pure,
fully-tested function (ordered rule list + override file). Manual balances reuse the existing
`upsertAccount`/`upsertBalanceSnapshot`. No new dependencies, no credentials, no network.

**Decisions baked in:** IBI/pension = **balances only** (manual), not full transaction import (IBI isn't
covered by `israeli-bank-scrapers`; value-over-time is all the dashboard needs). Automated IBI scraping is a
**tracked research follow-up**, not built here. Categorization is rule-based (deterministic, local — no LLM
calls on financial data); unknowns fall to `other`; user overrides live in `~/.kesef/categories.json`.

---

## Task 1: Categorization engine (`categorize.ts`) — TDD, pure

**Files:** create `packages/ingestion/src/categorize.ts`, `packages/ingestion/test/categorize.test.ts`; export from `index.ts`.

- [ ] **Step 1: Failing test** — `test/categorize.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { categorize } from '../src/categorize';

describe('categorize', () => {
  it('matches Hebrew + English merchants to categories', () => {
    expect(categorize('שופרסל דיל')).toBe('groceries');
    expect(categorize('RAMI LEVY')).toBe('groceries');
    expect(categorize('פז יבcorp')).toBe('transport');
    expect(categorize('NETFLIX.COM')).toBe('entertainment');
    expect(categorize('חברת חשמל לישראל')).toBe('utilities');
    expect(categorize('סופר פארם')).toBe('health');
    expect(categorize('משכורת')).toBe('income');
  });
  it('is case-insensitive and substring-based', () => {
    expect(categorize('payment to NeTfLiX')).toBe('entertainment');
  });
  it('falls back to other for unknown merchants', () => {
    expect(categorize('סתם משהו לא מוכר')).toBe('other');
  });
  it('applies user overrides with precedence', () => {
    // override map: substring -> category
    expect(categorize('CORNER SHOP', { 'corner shop': 'groceries' })).toBe('groceries');
    // override beats a built-in rule too
    expect(categorize('שופרסל', { 'שופרסל': 'shopping' })).toBe('shopping');
  });
});
```

- [ ] **Step 2: Run → fails** (`npm test -- categorize`).

- [ ] **Step 3: Implement** — `packages/ingestion/src/categorize.ts`:
```ts
import type { CategoryCode } from '@kesef/core';

// Ordered: earlier rules win. Each rule = [category, [substrings to match, lower-cased]].
// Seeded with common Israeli merchants (Hebrew + English). Extend freely.
const RULES: ReadonlyArray<readonly [CategoryCode, readonly string[]]> = [
  ['income',        ['משכורת', 'salary', 'זיכוי משכורת', 'קצבה']],
  ['transfer',      ['העברה', 'bit', 'ביט', 'paybox', 'פייבוקס', 'transfer']],
  ['housing',       ['שכירות', 'משכנתא', 'mortgage', 'rent', 'ארנונה', 'ועד בית']],
  ['utilities',     ['חברת חשמל', 'חשמל', 'מים', 'תאגיד', 'בזק', 'bezeq', 'hot', 'הוט', 'פרטנר', 'partner', 'סלקום', 'cellcom', 'yes', 'גולן', 'אינטרנט', 'rezef']],
  ['groceries',     ['שופרסל', 'shufersal', 'רמי לוי', 'rami levy', 'ויקטורי', 'יינות ביתן', 'אושר עד', 'טיב טעם', 'tiv taam', 'מגה', 'יוחננוף', 'אם פm', 'סופרמרקט']],
  ['dining',        ['קפה', 'cafe', 'מסעד', 'restaurant', 'וולט', 'wolt', 'מקדונלד', 'mcdonald', 'burger', 'בורגר', 'פיצה', 'pizza', 'ארומה', 'aroma', 'גולדה', 'רולדין']],
  ['transport',     ['פז', 'paz', 'סונול', 'sonol', 'דלק', 'delek', 'ten', 'רכבת', 'רב קו', 'רב-קו', 'gett', 'יאנגו', 'yango', 'אגד', 'דן', 'חניון', 'parking', 'pango', 'סלופארק', 'celopark']],
  ['health',        ['סופר פארם', 'super-pharm', 'superpharm', 'מכבי', 'כללית', 'מאוחדת', 'לאומית', 'בית מרקחת', 'pharm', 'מרפאה', 'clinic', 'רופא']],
  ['entertainment', ['נטפליקס', 'netflix', 'spotify', 'ספוטיפיי', 'סינמה', 'cinema', 'יס פלאנט', 'דיסני', 'disney', 'youtube', 'סטימצקי']],
  ['shopping',      ['זארה', 'zara', 'fox', 'קסטרו', 'castro', 'terminalx', 'טרמינל', 'ace', 'איקאה', 'ikea', 'amazon', 'אמזון', 'aliexpress', 'עלי אקספרס', 'next']],
  ['fees',          ['עמלה', 'דמי ניהול', 'ריבית', 'fee', 'commission']],
  ['investment',    ['השקעה', 'ניירות ערך', 'ני"ע', 'ibi', 'בית השקעות']],
  ['savings',       ['חיסכון', 'פיקדון', 'פקדון']],
];

/** Map a transaction description to a category. User overrides (substring -> category) win. */
export function categorize(description: string, overrides?: Record<string, CategoryCode>): CategoryCode {
  const hay = description.toLowerCase();
  if (overrides) {
    for (const [sub, cat] of Object.entries(overrides)) {
      if (sub && hay.includes(sub.toLowerCase())) return cat;
    }
  }
  for (const [cat, subs] of RULES) {
    if (subs.some(s => hay.includes(s))) return cat;
  }
  return 'other';
}
```
Add `export * from './categorize';` to `packages/ingestion/src/index.ts`.

- [ ] **Step 4: Run → passes.** Then full `npm test` + `npm run typecheck`. Do NOT commit.

---

## Task 2: Override loader + `Store.allTransactions()` — TDD

**Files:** modify `packages/core/src/store.ts` (+ `packages/core/test/store-sync.test.ts` add a case); create `packages/ingestion/src/overrides.ts`.

- [ ] **Step 1: Failing test for allTransactions** — append to `packages/core/test/store-sync.test.ts`:
```ts
  it('allTransactions returns every transaction across accounts', () => {
    const s = Store.open({ path: newDb(), key: 'pw' });
    s.upsertAccount(a);
    s.upsertTransaction(t);
    s.upsertTransaction({ ...t, id: 't2', date: '2026-05-02' });
    expect(s.allTransactions()).toHaveLength(2);
    s.close();
  });
```

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement** — add to `Store` in `packages/core/src/store.ts`:
```ts
  allTransactions(): Transaction[] {
    return (this.db.prepare('SELECT * FROM transactions ORDER BY date, id').all() as Record<string, unknown>[]).map(rowToTransaction);
  }
```
(`rowToTransaction` already exists.)

- [ ] **Step 4: Override loader** — `packages/ingestion/src/overrides.ts`:
```ts
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { CategoryCode } from '@kesef/core';

/** Load ~/.kesef/categories.json: { "merchant substring": "categoryCode", ... }. Missing/invalid → {}. */
export function loadOverrides(): Record<string, CategoryCode> {
  const path = join(homedir(), '.kesef', 'categories.json');
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed as Record<string, CategoryCode> : {};
  } catch { return {}; }
}
```
Export both from `index.ts` (`export * from './overrides';`).

- [ ] **Step 5: Run → passes** (`npm test`). `npm run typecheck` clean. Do NOT commit.

---

## Task 3: CLI — auto-categorize on sync, `categorize`, `add-balance`

**Files:** modify `packages/ingestion/src/cli.ts`; modify root `package.json` scripts.

- [ ] **Step 1: Auto-categorize on sync.** In `cli.ts` `sync()`, after `const { accounts, transactions, snapshots } = res.data!;` and before upserting, apply categories:
```ts
  const overrides = loadOverrides();
  for (const t of transactions) t.category = categorize(t.description, overrides);
```
(import `categorize` and `loadOverrides` from `./categorize.js` / `./overrides.js`.)

- [ ] **Step 2: `categorize` command** — re-categorize everything already stored (so existing 11 txns get labels):
```ts
async function recategorize(): Promise<void> {
  const key = await getDbKey(false);
  const store = Store.open({ path: dbPath(), key });
  const overrides = loadOverrides();
  const txns = store.allTransactions();
  const counts: Record<string, number> = {};
  for (const t of txns) {
    t.category = categorize(t.description, overrides);
    store.upsertTransaction(t);
    counts[t.category] = (counts[t.category] ?? 0) + 1;
  }
  console.log(`✓ Categorised ${txns.length} transaction(s):`);
  for (const [c, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`   ${c}: ${n}`);
  store.close();
}
```

- [ ] **Step 3: `add-balance` command** — record a manual balance for IBI / pension / other:
```ts
async function addBalance(): Promise<void> {
  const kind = (await ask('Account (ibi / pension / other): ')).toLowerCase();
  let id: string, institution: 'ibi' | 'manual', type: 'investment' | 'pension' | 'bank', name: string;
  if (kind === 'ibi') { id = 'ibi:portfolio'; institution = 'ibi'; type = 'investment'; name = 'IBI portfolio'; }
  else if (kind === 'pension') { id = 'manual:pension'; institution = 'manual'; type = 'pension'; name = 'Pension'; }
  else {
    const slug = (await ask('Short name for this account (e.g. gemel): ')).trim() || 'account';
    id = `manual:${slug}`; institution = 'manual'; type = 'bank'; name = (await ask('Display name: ')).trim() || slug;
  }
  const value = Number((await ask('Current value in ₪: ')).replace(/[, ]/g, ''));
  if (!Number.isFinite(value)) { console.error('Not a number.'); process.exit(1); }
  const date = (await ask('Date (YYYY-MM-DD, blank = today): ')).trim() || todayISO();
  const key = await getDbKey(true); // allow first-run before any sync
  const store = Store.open({ path: dbPath(), key });
  store.upsertAccount({ id, institution, type, displayName: name, currency: 'ILS', shareable: false });
  store.upsertBalanceSnapshot({ id: `${id}@${date}`, accountId: id, date, balance: value });
  console.log(`✓ Recorded ${name}: ₪${value.toLocaleString('en-US')} on ${date}`);
  store.close();
}
```

- [ ] **Step 4: Register commands** — update the dispatch map and root scripts:
```ts
const cmds: Record<string, () => Promise<void>> = { connect, sync, status, categorize: recategorize, 'add-balance': addBalance };
```
Root `package.json` scripts add:
```json
"categorize": "tsx packages/ingestion/src/cli.ts categorize",
"add-balance": "tsx packages/ingestion/src/cli.ts add-balance"
```

- [ ] **Step 5: Verify** — `npm run typecheck` clean; `npm test` green. Smoke (no creds/network): `npm run categorize` on the existing DB should label the 11 stored transactions and print a per-category breakdown. `npm run add-balance` interactively records a snapshot (can use a throwaway "other" account, then it shows in `npm run status` account count). Do NOT commit (controller commits).

---

## Verification (end of Phase 2b)
- `npm test` green (categorize, allTransactions + all prior); `npm run typecheck` clean.
- `npm run categorize` labels the real stored transactions (breakdown printed); re-running is idempotent.
- `npm run add-balance` records IBI + pension values → they appear as accounts (feeds net-worth in Phase 3).
- New `npm run sync` runs now auto-categorize.

## Out of scope / tracked follow-ups
- **Research: is automating IBI worth it?** (login/2FA/fragility of a custom IBI scraper) — deferred per user.
- Per-transaction manual category override UI (vs the file) → Phase 3.
- Investment holdings/trade detail, CSV import → only if the research says it's worth it.
- Phase-1 store-hardening (user_version migrations, cipher_compatibility pin) still tracked.
