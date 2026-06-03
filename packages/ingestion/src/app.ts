import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { KeyringVault, Store, buildDashboard, type Goal, type CategoryCode } from '@kesef/core';
import { dbPath } from './paths.js';
import { manualAccountFor, type BalanceKind } from './manualAccounts.js';
import { runSync, type SyncEvent } from './syncRun.js';

const BALANCE_KINDS = new Set<BalanceKind>(['pension', 'gemel', 'keren', 'ibi', 'savings', 'other']);
const todayISO = () => new Date().toISOString().slice(0, 10);

const vault = new KeyringVault('kesef');
const webDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const port = Number(process.env.PORT) || 8750;

const CATEGORIES = new Set<string>([
  'groceries', 'dining', 'transport', 'housing', 'utilities', 'health', 'shopping',
  'entertainment', 'income', 'transfer', 'savings', 'investment', 'fees', 'other',
]);

async function dbKey(): Promise<string> {
  const k = await vault.get('db-key');
  if (!k) throw new Error('No data yet — run `npm run sync` first.');
  return k;
}

/** Local DB encryption key (not a bank credential); created on first sync. */
async function getOrCreateDbKey(): Promise<string> {
  let k = await vault.get('db-key');
  if (!k) { k = randomBytes(32).toString('hex'); await vault.set('db-key', k); }
  return k;
}

let syncing = false; // only one sync run at a time

/** Open the encrypted store, run fn, always close. */
async function withStore<T>(fn: (s: Store) => T): Promise<T> {
  const s = Store.open({ path: dbPath(), key: await dbKey() });
  try { return fn(s); } finally { s.close(); }
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = ''; let size = 0;
    req.on('data', (c: Buffer) => { size += c.length; if (size > 1_000_000) { req.destroy(); reject(new Error('body too large')); } else body += c; });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('invalid json')); } });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, code: number, obj: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const path = url.pathname;
  const method = req.method ?? 'GET';
  try {
    // --- write API (local only) ---
    if (path === '/api/category' && method === 'POST') {
      const b = await readJson(req);
      const txnId = typeof b['txnId'] === 'string' ? b['txnId'] : '';
      const category = typeof b['category'] === 'string' ? b['category'] : '';
      if (!txnId || !CATEGORIES.has(category)) return sendJson(res, 400, { error: 'txnId + valid category required' });
      // scope 'merchant' makes the change stick to EVERY transaction of this merchant (incl. future syncs).
      const scope = b['scope'] === 'merchant' ? 'merchant' : 'one';
      const merchant = typeof b['merchant'] === 'string' ? b['merchant'].trim() : '';
      await withStore(s => {
        if (scope === 'merchant' && merchant) {
          s.setMerchantRule(merchant, category);
          s.clearCategoryOverride(txnId); // let the merchant rule govern this row too
        } else {
          s.setCategoryOverride(txnId, category);
        }
      });
      return sendJson(res, 200, { ok: true });
    }
    if (path === '/api/goals' && method === 'POST') {
      const b = await readJson(req);
      // targetDate is OPTIONAL — a goal need not have a deadline.
      const name = typeof b['name'] === 'string' ? b['name'].trim() : '';
      if (!name || typeof b['targetAmount'] !== 'number' || !(b['targetAmount'] > 0)) {
        return sendJson(res, 400, { error: 'name + positive targetAmount required' });
      }
      const goal: Goal = {
        id: typeof b['id'] === 'string' && b['id'] ? b['id'] : randomUUID(),
        name, targetAmount: b['targetAmount'],
        currentAmount: typeof b['currentAmount'] === 'number' ? b['currentAmount'] : 0,
        shareable: !!b['shareable'],
      };
      if (typeof b['targetDate'] === 'string' && b['targetDate']) goal.targetDate = b['targetDate'];
      await withStore(s => s.upsertGoal(goal));
      return sendJson(res, 200, { ok: true, goal });
    }
    if (path === '/api/goals' && method === 'DELETE') {
      const id = url.searchParams.get('id');
      if (!id) return sendJson(res, 400, { error: 'id required' });
      await withStore(s => s.deleteGoal(id));
      return sendJson(res, 200, { ok: true });
    }
    // Add/update a manual balance (pension, gemel, keren, IBI, savings, other) → counts toward net worth.
    if (path === '/api/balance' && method === 'POST') {
      const b = await readJson(req);
      const kind = b['kind'] as BalanceKind;
      const value = typeof b['value'] === 'number' ? b['value'] : Number(b['value']);
      if (!BALANCE_KINDS.has(kind) || !Number.isFinite(value)) {
        return sendJson(res, 400, { error: 'valid kind + numeric value required' });
      }
      const name = typeof b['name'] === 'string' ? b['name'] : undefined;
      const date = (typeof b['date'] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b['date'])) ? b['date'] : todayISO();
      const spec = manualAccountFor(kind, name);
      await withStore(s => {
        s.upsertAccount({ id: spec.id, institution: spec.institution, type: spec.type, displayName: spec.displayName, currency: 'ILS', shareable: false });
        s.upsertBalanceSnapshot({ id: `${spec.id}@${date}`, accountId: spec.id, date, balance: value });
      });
      return sendJson(res, 200, { ok: true, account: spec, date, value });
    }
    if (path === '/api/balance' && method === 'DELETE') {
      const id = url.searchParams.get('id');
      if (!id) return sendJson(res, 400, { error: 'id required' });
      await withStore(s => s.deleteAccount(id));
      return sendJson(res, 200, { ok: true });
    }

    // --- sync (Server-Sent Events): runs all sources with live progress, no terminal ---
    if (path === '/api/sync' && method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      const send = (e: SyncEvent | { type: string; [k: string]: unknown }) => res.write(`data: ${JSON.stringify(e)}\n\n`);

      // Dry-run: scripted events to verify the UI without opening any browsers.
      if (url.searchParams.get('dry') === '1') {
        send({ type: 'start', sources: ['Beinleumi', 'Cal', 'IBI'] });
        send({ type: 'source-start', source: 'Beinleumi', hint: '(dry run)' });
        send({ type: 'source-done', source: 'Beinleumi', accounts: 1, transactions: 11 });
        send({ type: 'source-start', source: 'Cal' });
        send({ type: 'source-done', source: 'Cal', accounts: 1, transactions: 208 });
        send({ type: 'source-start', source: 'IBI' });
        send({ type: 'source-done', source: 'IBI', value: 312450 });
        send({ type: 'complete', transactions: 219, accounts: 5 });
        res.end();
        return;
      }

      if (syncing) { send({ type: 'fatal', message: 'a sync is already running' }); res.end(); return; }
      syncing = true;
      let store: Store | undefined;
      try {
        store = Store.open({ path: dbPath(), key: await getOrCreateDbKey() });
        const now = new Date().toISOString().slice(0, 10);
        await runSync({ store, now, onEvent: send });
      } catch (e) {
        send({ type: 'fatal', message: e instanceof Error ? e.message : 'sync failed' });
      } finally {
        store?.close();
        syncing = false;
        res.end();
      }
      return;
    }

    // --- dashboard ---
    if (path === '/' && method === 'GET') {
      const model = await withStore(s => buildDashboard(
        s.listAccounts(), s.allTransactions(), s.allBalanceSnapshots(),
        new Date().toISOString().slice(0, 10),
        { goals: s.listGoals(), overrides: s.categoryOverrides() as Map<string, CategoryCode>, merchantRules: s.merchantRules() },
      ));
      const json = JSON.stringify(model).replace(/</g, '\\u003c'); // can't break out of <script>
      const html = readFileSync(join(webDir, 'dashboard.html'), 'utf8').replace('/*__KESEF_DATA__*/ null', () => json);
      // never cache the dashboard — a plain refresh should always show the latest build + data
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store, must-revalidate' });
      res.end(html);
      return;
    }

    res.writeHead(404); res.end('not found');
  } catch (e) {
    sendJson(res, 500, { error: e instanceof Error ? e.message : 'error' });
  }
}).listen(port, '127.0.0.1', () => console.log(`kesef dashboard → http://localhost:${port}  (Ctrl-C to stop)`));
