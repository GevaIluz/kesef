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
  it('stores and reads per-transaction category overrides', () => {
    const s = Store.open({ path: newDb(), key: 'pw' });
    s.setCategoryOverride('t1', 'investment');
    s.setCategoryOverride('t1', 'savings'); // overwrite
    s.setCategoryOverride('t2', 'housing');
    const m = s.categoryOverrides();
    expect(m.get('t1')).toBe('savings');
    expect(m.get('t2')).toBe('housing');
    s.close();
  });
  it('stores and reads merchant category rules (the app "learns" a merchant)', () => {
    const s = Store.open({ path: newDb(), key: 'pw' });
    s.setMerchantRule('Lime', 'transport');
    s.setMerchantRule('Lime', 'fees');     // overwrite
    s.setMerchantRule('Wolt', 'dining');
    const m = s.merchantRules();
    expect(m.get('Lime')).toBe('fees');
    expect(m.get('Wolt')).toBe('dining');
    s.close();
  });
  it('goals CRUD', () => {
    const s = Store.open({ path: newDb(), key: 'pw' });
    const g = { id: 'g1', name: 'Japan', targetAmount: 40000, targetDate: '2027-01-01', currentAmount: 1000, shareable: false };
    s.upsertGoal(g);
    s.upsertGoal({ ...g, currentAmount: 5000 });
    expect(s.listGoals()).toHaveLength(1);
    expect(s.listGoals()[0]!.currentAmount).toBe(5000);
    s.deleteGoal('g1');
    expect(s.listGoals()).toHaveLength(0);
    s.close();
  });
  it('account components round-trip and survive a value-only re-upsert', () => {
    const s = Store.open({ path: newDb(), key: 'pw' });
    s.upsertAccount({ ...a, id: 'm1', components: [{ name: 'גמל', value: 100 }, { name: 'פנסיה', value: 50 }] });
    expect(s.listAccounts().find(x => x.id === 'm1')!.components).toEqual([{ name: 'גמל', value: 100 }, { name: 'פנסיה', value: 50 }]);
    s.upsertAccount({ ...a, id: 'm1' }); // re-upsert without components must NOT wipe them
    expect(s.listAccounts().find(x => x.id === 'm1')!.components).toEqual([{ name: 'גמל', value: 100 }, { name: 'פנסיה', value: 50 }]);
    s.close();
  });
  it('deleteAccount removes the account and its snapshots/transactions', () => {
    const s = Store.open({ path: newDb(), key: 'pw' });
    s.upsertAccount(a);
    s.upsertTransaction(t);
    s.upsertBalanceSnapshot({ id: 's1', accountId: 'a1', date: '2026-05-01', balance: 1000 });
    s.deleteAccount('a1');
    expect(s.countAccounts()).toBe(0);
    expect(s.countTransactions()).toBe(0);
    expect(s.allBalanceSnapshots()).toHaveLength(0);
    s.close();
  });
  it('goal without a target date round-trips (deadline is optional)', () => {
    const s = Store.open({ path: newDb(), key: 'pw' });
    s.upsertGoal({ id: 'g2', name: 'Emergency fund', targetAmount: 30000, currentAmount: 0, shareable: false });
    const got = s.listGoals().find(g => g.id === 'g2')!;
    expect(got.targetAmount).toBe(30000);
    expect(got.targetDate).toBeUndefined();
    s.close();
  });

  it('couple pairing: setPairing/getPairing round-trips; null when unpaired', () => {
    const s = Store.open({ path: newDb(), key: 'pw' });
    expect(s.getPairing()).toBeNull();
    s.setPairing({ pairingId: 'abc', role: 'A', partnerLabel: 'Partner', relayUrl: 'https://relay.example', createdAt: '2026-06-04', localSeq: 0, partnerSeq: 0 });
    expect(s.getPairing()).toEqual({ pairingId: 'abc', role: 'A', partnerLabel: 'Partner', relayUrl: 'https://relay.example', createdAt: '2026-06-04', localSeq: 0, partnerSeq: 0 });
    s.close();
  });

  it('couple pairing: setPairing upserts (bump seq) and clearPairing disconnects', () => {
    const s = Store.open({ path: newDb(), key: 'pw' });
    s.setPairing({ pairingId: 'abc', role: 'A', createdAt: '2026-06-04', localSeq: 0, partnerSeq: 0 });
    s.setPairing({ pairingId: 'abc', role: 'A', createdAt: '2026-06-04', localSeq: 7, partnerSeq: 3 });
    expect(s.getPairing()!.localSeq).toBe(7);
    expect(s.getPairing()!.partnerSeq).toBe(3);
    s.clearPairing();
    expect(s.getPairing()).toBeNull();
    s.close();
  });
});
