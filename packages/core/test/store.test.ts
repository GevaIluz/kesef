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
    expect(raw.subarray(0, 16).toString()).not.toBe('SQLite format 3 '); // header is encrypted too
  });

  it('rejects an empty key', () => {
    expect(() => Store.open({ path: newDb(), key: '' })).toThrow(/empty/i);
  });

  it('rejects a key containing a NUL byte', () => {
    const keyWithNul = 'a' + String.fromCharCode(0) + 'b';
    expect(() => Store.open({ path: newDb(), key: keyWithNul })).toThrow(/NUL/i);
  });

  it('wrong key throws a sanitized error that does not echo the passphrase', () => {
    const path = newDb();
    Store.open({ path, key: 'right' }).close();
    const secret = 'SuperSecretPass!';
    let msg = '';
    try { Store.open({ path, key: secret }); } catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(/invalid key or unreadable/i);
    expect(msg).not.toContain(secret);
  });
});
