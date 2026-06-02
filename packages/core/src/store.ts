import Database from 'better-sqlite3-multiple-ciphers';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Account, Transaction, BalanceSnapshot } from './types';

const SCHEMA = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'schema.sql'), 'utf8');
const NUL = String.fromCharCode(0);

export interface OpenStoreOptions {
  path: string;
  key: string; // passphrase; applied via SQLCipher PRAGMA key
}

export class Store {
  private constructor(private db: Database.Database) {}

  static open(opts: OpenStoreOptions): Store {
    const { path, key } = opts;
    // Guard the one value interpolated into a PRAGMA. A NUL would silently truncate the key
    // inside SQLCipher's C layer (yielding a different, weaker key than intended).
    if (key.length === 0) throw new Error('Store.open: key must not be empty');
    if (key.includes(NUL)) throw new Error('Store.open: key must not contain NUL bytes');

    const db = new Database(path);
    try {
      db.pragma("cipher='sqlcipher'"); // AES-256-CBC + HMAC-SHA (matches "AES-256 at rest")
      db.pragma(`key='${key.replace(/'/g, "''")}'`); // '→'' escaping; SQLite has no backslash escape
      // Force a read so an invalid key fails fast (SQLCipher verifies lazily otherwise).
      db.exec('SELECT count(*) FROM sqlite_master;'); // throws on wrong key
      db.pragma('foreign_keys = ON'); // per-connection; establish before any DML
      db.exec(SCHEMA);
    } catch (cause) {
      db.close(); // never leak the native handle on the (expected) wrong-key path
      // Sanitized: the message must never carry the passphrase or raw SQL (could reach logs).
      throw new Error('Store.open: invalid key or unreadable database', { cause });
    }
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
    return (this.db.prepare('SELECT * FROM accounts ORDER BY id').all() as Record<string, unknown>[]).map(rowToAccount);
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
    return (this.db.prepare('SELECT * FROM transactions WHERE account_id = ? ORDER BY date, id')
      .all(accountId) as Record<string, unknown>[]).map(rowToTransaction);
  }

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

  close(): void { this.db.close(); }
}

function rowToAccount(r: Record<string, unknown>): Account {
  return {
    id: r['id'] as string,
    institution: r['institution'] as Account['institution'],
    type: r['type'] as Account['type'],
    displayName: r['display_name'] as string,
    currency: r['currency'] as Account['currency'],
    shareable: !!(r['shareable'] as number),
  };
}

function rowToTransaction(r: Record<string, unknown>): Transaction {
  const t: Transaction = {
    id: r['id'] as string,
    accountId: r['account_id'] as string,
    date: r['date'] as string,
    amount: r['amount'] as number,
    description: r['description'] as string,
    shareable: r['shareable'] == null ? undefined : !!(r['shareable'] as number),
  };
  if (r['raw_category'] != null) t.rawCategory = r['raw_category'] as string;
  if (r['category'] != null) t.category = r['category'] as Transaction['category'];
  return t;
}
