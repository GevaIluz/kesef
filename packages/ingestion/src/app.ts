import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { KeyringVault, Store, buildDashboard, type Goal, type CategoryCode, type Payslip, type Horizon, type MonthlyPlan } from '@kesef/core';
import { dbPath } from './paths.js';
import { manualAccountFor, type BalanceKind } from './manualAccounts.js';
import { runSync, type SyncEvent, type SyncSource } from './syncRun.js';
import { pairGenerate, pairJoin, unpair, syncWithPartner, buildMySummary, localCoupleModel } from './coupleSync.js';
import { loginUrlFor, setLoginUrl, type LoginSource } from './loginConfig.js';

const BALANCE_KINDS = new Set<BalanceKind>(['pension', 'gemel', 'keren', 'ibi', 'savings', 'other']);
const todayISO = () => new Date().toISOString().slice(0, 10);

const vault = new KeyringVault('kesef');
const webDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const port = Number(process.env.PORT) || 8750;

const STATIC_FILES: Record<string, string> = {
  '/manifest.webmanifest': 'application/manifest+json',
  '/icon-192.png': 'image/png',
  '/icon-512.png': 'image/png',
  '/apple-touch-icon.png': 'image/png',
};

const CATEGORIES = new Set<string>([
  'groceries', 'dining', 'transport', 'housing', 'utilities', 'health', 'shopping',
  'entertainment', 'income', 'transfer', 'savings', 'investment', 'fees', 'other',
]);
const HORIZONS = new Set<string>(['daily', 'medium', 'long']);

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

/** Like withStore but AWAITS fn (for async work like couple sync) and creates the db key if missing. */
async function withStoreRW<T>(fn: (s: Store) => Promise<T> | T): Promise<T> {
  const s = Store.open({ path: dbPath(), key: await getOrCreateDbKey() });
  try { return await fn(s); } finally { s.close(); }
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

const server = createServer(async (req, res) => {
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
      // optional breakdown of what the balance is composed of (e.g. MVS products)
      const components = Array.isArray(b['components'])
        ? (b['components'] as unknown[])
            .map(c => (c && typeof c === 'object') ? c as { name?: unknown; value?: unknown } : {})
            .filter(c => typeof c.name === 'string' && typeof c.value === 'number')
            .map(c => ({ name: c.name as string, value: c.value as number }))
        : undefined;
      const spec = manualAccountFor(kind, name);
      await withStore(s => {
        s.upsertAccount({ id: spec.id, institution: spec.institution, type: spec.type, displayName: spec.displayName, currency: 'ILS', shareable: false, ...(components && components.length ? { components } : {}) });
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
    // Tag an account (or one of its components) with a horizon override — null clears back to Auto.
    if (path === '/api/horizon' && method === 'POST') {
      const b = await readJson(req);
      const kind = b['kind'];
      const accountId = typeof b['accountId'] === 'string' ? b['accountId'] : '';
      const horizonRaw = b['horizon'];
      const horizon: Horizon | null | undefined = horizonRaw === null ? null
        : (typeof horizonRaw === 'string' && HORIZONS.has(horizonRaw)) ? horizonRaw as Horizon : undefined;
      if ((kind !== 'account' && kind !== 'component') || !accountId || horizon === undefined) {
        return sendJson(res, 400, { error: 'kind (account|component) + accountId + horizon (daily|medium|long|null) required' });
      }
      if (kind === 'component') {
        const componentName = typeof b['componentName'] === 'string' ? b['componentName'] : '';
        if (!componentName) return sendJson(res, 400, { error: 'componentName required for kind=component' });
        await withStore(s => s.setComponentHorizon(accountId, componentName, horizon));
      } else {
        await withStore(s => s.setAccountHorizon(accountId, horizon));
      }
      return sendJson(res, 200, { ok: true });
    }
    // F6 — monthly plan: one quiet savings/investment intent (e.g. "₪2,000 to IBI"); v1 keeps at most one.
    if (path === '/api/plan' && method === 'POST') {
      const b = await readJson(req);
      const amount = typeof b['amount'] === 'number' ? b['amount'] : Number(b['amount']);
      const label = typeof b['label'] === 'string' ? b['label'].trim() : '';
      if (!Number.isFinite(amount) || !(amount > 0) || !label) {
        return sendJson(res, 400, { error: 'amount > 0 + non-empty label required' });
      }
      const plan: MonthlyPlan = { amount, label };
      await withStore(s => s.setPlan(plan));
      return sendJson(res, 200, { ok: true, plan });
    }
    if (path === '/api/plan' && method === 'DELETE') {
      await withStore(s => s.deletePlan());
      return sendJson(res, 200, { ok: true });
    }

    // --- couple sharing: per-item opt-in + zero-knowledge sync with a partner ---
    if (path === '/api/couple/state' && method === 'GET') {
      const p = await withStoreRW(s => s.getPairing());
      return sendJson(res, 200, p
        ? { paired: true, role: p.role, partnerLabel: p.partnerLabel ?? null, relayUrl: p.relayUrl ?? null, createdAt: p.createdAt }
        : { paired: false });
    }
    if (path === '/api/couple/pair' && method === 'POST') {
      const b = await readJson(req);
      const relayUrl = typeof b['relayUrl'] === 'string' ? b['relayUrl'].trim() : '';
      const partnerLabel = typeof b['partnerLabel'] === 'string' && b['partnerLabel'].trim() ? b['partnerLabel'].trim() : undefined;
      if (!relayUrl) return sendJson(res, 400, { error: 'relayUrl required' });
      const now = todayISO();
      if (b['mode'] === 'join') {
        const token = typeof b['token'] === 'string' ? b['token'].trim() : '';
        if (!token) return sendJson(res, 400, { error: 'token required to join' });
        try {
          const pairing = await withStoreRW(s => pairJoin(s, vault, { token, relayUrl, partnerLabel, now }));
          return sendJson(res, 200, { ok: true, role: pairing.role });
        } catch (e) { return sendJson(res, 400, { error: e instanceof Error ? e.message : 'could not join' }); }
      }
      const { token } = await withStoreRW(s => pairGenerate(s, vault, { relayUrl, partnerLabel, now }));
      return sendJson(res, 200, { ok: true, role: 'A', token });
    }
    if (path === '/api/couple/unpair' && method === 'POST') {
      await withStoreRW(s => unpair(s, vault));
      return sendJson(res, 200, { ok: true });
    }
    if (path === '/api/couple/share' && method === 'POST') {
      const b = await readJson(req);
      const kind = b['kind']; const id = typeof b['id'] === 'string' ? b['id'] : '';
      const shareable = !!b['shareable'];
      if ((kind !== 'account' && kind !== 'goal') || !id) return sendJson(res, 400, { error: 'kind (account|goal) + id required' });
      await withStoreRW(s => kind === 'account' ? s.setAccountShareable(id, shareable) : s.setGoalShareable(id, shareable));
      return sendJson(res, 200, { ok: true });
    }
    if (path === '/api/couple/preview' && method === 'GET') {
      const summary = await withStoreRW(s => buildMySummary(s, todayISO()));
      return sendJson(res, 200, summary);
    }
    // Instant couple view from LOCAL data only (no relay): my full side, partner empty. Always works,
    // even unpaired — so I can always see my own money in the couple view.
    if (path === '/api/couple/view' && method === 'GET') {
      const out = await withStoreRW(s => {
        const p = s.getPairing();
        return { model: localCoupleModel(s, todayISO()), paired: !!p, partnerLabel: p?.partnerLabel ?? null };
      });
      return sendJson(res, 200, out);
    }
    if (path === '/api/couple/sync' && method === 'POST') {
      try {
        const result = await withStoreRW(s => syncWithPartner(s, vault, todayISO()));
        return sendJson(res, 200, { model: result.model, mine: result.mine, partnerError: result.partnerError ?? null, partnerAsOf: result.partnerAsOf ?? null });
      } catch (e) { return sendJson(res, 200, { model: null, error: e instanceof Error ? e.message : 'sync failed' }); }
    }

    // --- payslips: the gross→net story the bank never sees ---
    if (path === '/api/payslip' && method === 'POST') {
      const b = await readJson(req);
      const month = typeof b['month'] === 'string' && /^\d{4}-\d{2}$/.test(b['month']) ? b['month'] : '';
      const num = (k: string) => { const v = b[k]; return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0; };
      const gross = num('gross'), net = num('net');
      if (!month || gross <= 0 || net <= 0 || net > gross) {
        return sendJson(res, 400, { error: 'month (YYYY-MM) + gross ≥ net > 0 required' });
      }
      const p: Payslip = {
        month, gross, net, tax: num('tax'),
        pensionEmp: num('pensionEmp'), kerenEmp: num('kerenEmp'), espp: num('espp'), otherEmp: num('otherEmp'),
        employerPension: num('employerPension'), employerSeverance: num('employerSeverance'), employerKeren: num('employerKeren'),
      };
      await withStoreRW(s => s.upsertPayslip(p));
      return sendJson(res, 200, { ok: true, payslip: p });
    }
    if (path === '/api/payslip' && method === 'DELETE') {
      const month = url.searchParams.get('month');
      if (!month) return sendJson(res, 400, { error: 'month required' });
      await withStore(s => s.deletePayslip(month));
      return sendJson(res, 200, { ok: true });
    }

    // --- per-source login URL (point a bank at its QR / app-login page) ---
    if (path === '/api/login-url' && method === 'GET') {
      return sendJson(res, 200, { beinleumi: loginUrlFor('beinleumi') ?? '', cal: loginUrlFor('cal') ?? '' });
    }
    if (path === '/api/login-url' && method === 'POST') {
      const b = await readJson(req);
      const source = b['source'];
      const rawUrl = typeof b['url'] === 'string' ? b['url'].trim() : '';
      if (source !== 'beinleumi' && source !== 'cal') return sendJson(res, 400, { error: 'source must be beinleumi or cal' });
      // A blank url clears the override; a non-blank one must be a valid https URL (we open it in a browser).
      if (rawUrl) {
        let u: URL;
        try { u = new URL(rawUrl); } catch { return sendJson(res, 400, { error: 'invalid URL' }); }
        if (u.protocol !== 'https:') return sendJson(res, 400, { error: 'login URL must use https' });
      }
      setLoginUrl(source as LoginSource, rawUrl);
      return sendJson(res, 200, { ok: true });
    }

    // --- sync (Server-Sent Events): runs all sources with live progress, no terminal ---
    if (path === '/api/sync' && method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      // A sync streams for many minutes across 3 interactive logins, with long silent gaps while
      // the user logs in. Keep the socket alive and never let a timeout kill it mid-run.
      req.socket.setKeepAlive(true);
      req.socket.setTimeout(0);
      const safeWrite = (s: string) => { if (!res.writableEnded && res.socket && !res.socket.destroyed) { try { res.write(s); } catch { /* client gone */ } } };
      const send = (e: SyncEvent | { type: string; [k: string]: unknown }) => {
        if (e.type === 'source-error' || e.type === 'fatal') console.error('[sync]', JSON.stringify(e)); // also log to the server log
        safeWrite(`data: ${JSON.stringify(e)}\n\n`);
      };

      // Dry-run: scripted events to verify the UI without opening any browsers (honors ?only=).
      if (url.searchParams.get('dry') === '1') {
        const labels: Record<string, string> = { beinleumi: 'Beinleumi', cal: 'Cal', ibi: 'IBI', mvs: 'Mivtach Simon' };
        const onlyDry = (url.searchParams.get('only') || '').split(',').map(s => s.trim()).filter(s => labels[s]);
        const wantDry = onlyDry.length ? onlyDry : ['beinleumi', 'cal', 'ibi', 'mvs'];
        send({ type: 'start', sources: wantDry.map(s => labels[s]) });
        for (const s of wantDry) {
          send({ type: 'source-start', source: labels[s], hint: '(dry run)' });
          send(s === 'ibi' || s === 'mvs'
            ? { type: 'source-done', source: labels[s], value: s === 'ibi' ? 312450 : 164407 }
            : { type: 'source-done', source: labels[s], accounts: 1, transactions: s === 'cal' ? 208 : 11 });
        }
        send({ type: 'complete', transactions: 219, accounts: 5 });
        res.end();
        return;
      }

      if (syncing) { send({ type: 'fatal', message: 'a sync is already running' }); res.end(); return; }
      syncing = true;
      const heartbeat = setInterval(() => safeWrite(': keepalive\n\n'), 15_000); // hold the connection during login gaps
      req.on('close', () => clearInterval(heartbeat));
      let store: Store | undefined;
      try {
        store = Store.open({ path: dbPath(), key: await getOrCreateDbKey() });
        const now = new Date().toISOString().slice(0, 10);
        const valid: readonly string[] = ['beinleumi', 'cal', 'ibi', 'mvs'];
        const only = (url.searchParams.get('only') || '').split(',').map(s => s.trim()).filter(s => valid.includes(s)) as SyncSource[];
        await runSync({ store, now, onEvent: send, sources: only.length ? only : undefined });
      } catch (e) {
        send({ type: 'fatal', message: e instanceof Error ? e.message : 'sync failed' });
      } finally {
        clearInterval(heartbeat);
        store?.close();
        syncing = false;
        if (!res.writableEnded) res.end();
      }
      return;
    }

    // --- PWA assets (fixed whitelist — no path traversal possible) ---
    const staticType = STATIC_FILES[path];
    if (staticType && method === 'GET') {
      try {
        const buf = readFileSync(join(webDir, path.slice(1)));
        res.writeHead(200, { 'content-type': staticType, 'cache-control': 'public, max-age=86400' });
        res.end(buf);
      } catch {
        res.writeHead(404); res.end('not found');
      }
      return;
    }

    // --- dashboard ---
    if (path === '/' && method === 'GET') {
      const model = await withStore(s => {
        const p = s.getPairing();
        return buildDashboard(
          s.listAccounts(), s.allTransactions(), s.allBalanceSnapshots(),
          new Date().toISOString().slice(0, 10),
          {
            goals: s.listGoals(), overrides: s.categoryOverrides() as Map<string, CategoryCode>, merchantRules: s.merchantRules(),
            payslips: s.listPayslips(),
            couple: p ? { paired: true, role: p.role, partnerLabel: p.partnerLabel ?? null, relayUrl: p.relayUrl ?? null } : { paired: false },
            plan: s.getPlan(),
          },
        );
      });
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
});
// Long-running SSE syncs must not be killed by Node's default request/header/socket timeouts.
server.requestTimeout = 0;
server.headersTimeout = 0;
server.timeout = 0;
server.listen(port, '127.0.0.1', () => console.log(`kesef dashboard → http://localhost:${port}  (Ctrl-C to stop)`));
