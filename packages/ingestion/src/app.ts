import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { KeyringVault, Store, buildDashboard, type Goal, type CategoryCode } from '@kesef/core';
import { dbPath } from './paths.js';

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
      await withStore(s => s.setCategoryOverride(txnId, category));
      return sendJson(res, 200, { ok: true });
    }
    if (path === '/api/goals' && method === 'POST') {
      const b = await readJson(req);
      if (typeof b['name'] !== 'string' || typeof b['targetAmount'] !== 'number' || typeof b['targetDate'] !== 'string') {
        return sendJson(res, 400, { error: 'name + targetAmount + targetDate required' });
      }
      const goal: Goal = {
        id: typeof b['id'] === 'string' && b['id'] ? b['id'] : randomUUID(),
        name: b['name'], targetAmount: b['targetAmount'], targetDate: b['targetDate'],
        currentAmount: typeof b['currentAmount'] === 'number' ? b['currentAmount'] : 0,
        shareable: !!b['shareable'],
      };
      await withStore(s => s.upsertGoal(goal));
      return sendJson(res, 200, { ok: true, goal });
    }
    if (path === '/api/goals' && method === 'DELETE') {
      const id = url.searchParams.get('id');
      if (!id) return sendJson(res, 400, { error: 'id required' });
      await withStore(s => s.deleteGoal(id));
      return sendJson(res, 200, { ok: true });
    }

    // --- dashboard ---
    if (path === '/' && method === 'GET') {
      const model = await withStore(s => buildDashboard(
        s.listAccounts(), s.allTransactions(), s.allBalanceSnapshots(),
        new Date().toISOString().slice(0, 10),
        { goals: s.listGoals(), overrides: s.categoryOverrides() as Map<string, CategoryCode> },
      ));
      const json = JSON.stringify(model).replace(/</g, '\\u003c'); // can't break out of <script>
      const html = readFileSync(join(webDir, 'dashboard.html'), 'utf8').replace('/*__KESEF_DATA__*/ null', () => json);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    res.writeHead(404); res.end('not found');
  } catch (e) {
    sendJson(res, 500, { error: e instanceof Error ? e.message : 'error' });
  }
}).listen(port, '127.0.0.1', () => console.log(`kesef dashboard → http://localhost:${port}  (Ctrl-C to stop)`));
