import { randomBytes } from 'node:crypto';
import { KeyringVault, Store } from '@kesef/core';
import { join } from 'node:path';
import { dbPath, kesefDir } from './paths.js';
import { ask, askHidden } from './prompt.js';
import { scrapeBeinleumi } from './beinleumi.js';
import { scrapeCal } from './cal.js';
import { categorize, assignCategory } from './categorize.js';
import { loadOverrides } from './overrides.js';

const vault = new KeyringVault('kesef');
const todayISO = () => new Date().toISOString().slice(0, 10);

async function getDbKey(create: boolean): Promise<string> {
  let k = await vault.get('db-key');
  if (!k && create) { k = randomBytes(32).toString('hex'); await vault.set('db-key', k); }
  if (!k) throw new Error('No DB key — run `npm run connect` first.');
  return k;
}

async function connect(): Promise<void> {
  const inst = (await ask('Connect which? (beinleumi / cal): ')).trim().toLowerCase() === 'cal' ? 'cal' : 'beinleumi';
  const username = await ask(`${inst} username: `);
  const password = await askHidden(`${inst} password (hidden): `);
  await vault.set(`creds:${inst}`, JSON.stringify({ username, password }));
  if (inst === 'beinleumi') await vault.delete('beinleumi'); // drop any legacy pre-2c credential entry
  const key = await getDbKey(true);
  Store.open({ path: dbPath(), key }).close();
  console.log(`✓ Connected ${inst}. Credentials stored in your OS keychain.`);
  console.log('  Run `npm run sync` (or run connect again to add the other institution).');
}

async function sync(): Promise<void> {
  const headless = !!process.env.KESEF_HEADLESS, debug = !!process.env.KESEF_DEBUG;
  const overrides = loadOverrides();
  const common = {
    now: todayISO(), showBrowser: !headless, verbose: debug,
    failureScreenshotPath: debug ? join(kesefDir(), 'last-failure.png') : undefined,
  };

  // Which institutions are connected? (support legacy `beinleumi` key for back-compat)
  const insts: Array<'beinleumi' | 'cal'> = [];
  for (const inst of ['beinleumi', 'cal'] as const) {
    if ((await vault.get(`creds:${inst}`)) || (inst === 'beinleumi' && (await vault.get('beinleumi')))) insts.push(inst);
  }
  if (insts.length === 0) { console.error('Nothing connected — run `npm run connect`.'); process.exit(1); }
  if (!headless) console.log('(a browser window will open for each login, then close)');

  const key = await getDbKey(false);
  const store = Store.open({ path: dbPath(), key });
  for (const inst of insts) {
    const raw = (await vault.get(`creds:${inst}`)) ?? (await vault.get('beinleumi'));
    if (!raw) continue;
    let creds: { username: string; password: string };
    try { creds = JSON.parse(raw); } catch { console.error(`${inst}: stored credentials corrupt — re-run connect.`); continue; }
    console.log(`Logging in to ${inst}…`);
    const res = inst === 'cal' ? await scrapeCal(creds, common) : await scrapeBeinleumi(creds, common);
    if (!res.ok) { console.error(`✗ ${inst} failed: ${res.errorType ?? ''} ${res.errorMessage ?? ''}`.trim()); continue; }
    const { accounts, transactions, snapshots } = res.data!;
    for (const t of transactions) t.category = assignCategory(t, overrides);
    for (const a of accounts) store.upsertAccount(a);
    for (const t of transactions) store.upsertTransaction(t);
    for (const s of snapshots) store.upsertBalanceSnapshot(s);
    console.log(`  ✓ ${inst}: ${accounts.length} account(s), ${transactions.length} transaction(s).`);
  }
  console.log(`Stored total: ${store.countTransactions()} transactions across ${store.countAccounts()} accounts.`);
  store.close();
}

async function status(): Promise<void> {
  const key = await getDbKey(false);
  const store = Store.open({ path: dbPath(), key });
  console.log(`${store.countAccounts()} account(s), ${store.countTransactions()} transaction(s) in ~/.kesef/kesef.db`);
  store.close();
}

async function list(): Promise<void> {
  const key = await getDbKey(false);
  const store = Store.open({ path: dbPath(), key });
  const txns = store.allTransactions().slice(-50);
  for (const t of txns) {
    const amt = `${t.amount < 0 ? '−' : '+'}₪${Math.abs(t.amount).toLocaleString('en-US')}`.padStart(12);
    const cat = (t.category ?? '?').padEnd(13);
    const raw = t.rawCategory ? `[${t.rawCategory}] ` : '';
    console.log(`${t.date}  ${amt}  ${cat} ${raw}${t.description}`);
  }
  console.log(`(${store.countTransactions()} total; showing last ${txns.length})`);
  store.close();
}

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
  for (const [c, n] of Object.entries(counts).sort((x, y) => y[1] - x[1])) console.log(`   ${c}: ${n}`);
  store.close();
}

async function addBalance(): Promise<void> {
  const kind = (await ask('Account (ibi / pension / other): ')).toLowerCase();
  let id: string, institution: 'ibi' | 'manual', type: 'investment' | 'pension' | 'bank', name: string;
  if (kind === 'ibi') { id = 'ibi:portfolio'; institution = 'ibi'; type = 'investment'; name = 'IBI portfolio'; }
  else if (kind === 'pension') { id = 'manual:pension'; institution = 'manual'; type = 'pension'; name = 'Pension'; }
  else {
    const slug = (await ask('Short name (e.g. gemel): ')).trim() || 'account';
    id = `manual:${slug}`; institution = 'manual'; type = 'bank'; name = (await ask('Display name: ')).trim() || slug;
  }
  const value = Number((await ask('Current value in ₪: ')).replace(/[, ]/g, ''));
  if (!Number.isFinite(value)) { console.error('Not a number.'); process.exit(1); }
  const date = (await ask('Date (YYYY-MM-DD, blank = today): ')).trim() || todayISO();
  const key = await getDbKey(true);
  const store = Store.open({ path: dbPath(), key });
  store.upsertAccount({ id, institution, type, displayName: name, currency: 'ILS', shareable: false });
  store.upsertBalanceSnapshot({ id: `${id}@${date}`, accountId: id, date, balance: value });
  console.log(`✓ Recorded ${name}: ₪${value.toLocaleString('en-US')} on ${date}`);
  store.close();
}

const cmd = process.argv[2];
const cmds: Record<string, () => Promise<void>> = { connect, sync, status, categorize: recategorize, 'add-balance': addBalance, list };
(cmds[cmd ?? ''] ?? (async () => { console.error('usage: connect | sync | status | categorize | add-balance | list'); process.exit(1); }))()
  .catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
