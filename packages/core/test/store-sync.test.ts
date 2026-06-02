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
  it('allTransactions returns every transaction across accounts', () => {
    const s = Store.open({ path: newDb(), key: 'pw' });
    s.upsertAccount(a);
    s.upsertTransaction(t);
    s.upsertTransaction({ ...t, id: 't2', date: '2026-05-02' });
    expect(s.allTransactions()).toHaveLength(2);
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
