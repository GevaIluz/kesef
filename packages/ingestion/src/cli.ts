import { randomBytes } from 'node:crypto';
import { KeyringVault, Store } from '@kesef/core';
import { join } from 'node:path';
import { dbPath, kesefDir } from './paths.js';
import { ask, askHidden } from './prompt.js';
import { scrapeBeinleumi } from './beinleumi.js';
import { categorize } from './categorize.js';
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
  const username = await ask('Beinleumi username: ');
  const password = await askHidden('Beinleumi password (hidden): ');
  await vault.set('beinleumi', JSON.stringify({ username, password }));
  const key = await getDbKey(true);
  Store.open({ path: dbPath(), key }).close(); // initialize the encrypted DB
  console.log('✓ Connected. Credentials stored in your OS keychain; encrypted DB at ~/.kesef/kesef.db');
  console.log('  Next: `npm run sync`');
}

async function sync(): Promise<void> {
  const raw = await vault.get('beinleumi');
  if (!raw) { console.error('Not connected — run `npm run connect`.'); process.exit(1); }
  let creds: { username: string; password: string };
  try { creds = JSON.parse(raw); }
  catch { console.error('Stored credentials are corrupt — run `npm run connect` to re-enter.'); process.exit(1); }
  const { username, password } = creds;
  const debug = !!process.env.KESEF_DEBUG;
  const headless = !!process.env.KESEF_HEADLESS; // opt in to headless; Beinleumi login is unreliable headless
  if (!headless) console.log('(a browser window will open to complete the login, then close — this is expected)');
  if (debug) console.log('(debug: verbose logs; a failure screenshot is saved to ~/.kesef/last-failure.png)');
  console.log('Logging in to Beinleumi…');
  const res = await scrapeBeinleumi({ username, password }, {
    now: todayISO(),
    showBrowser: !headless,
    verbose: debug,
    failureScreenshotPath: debug ? join(kesefDir(), 'last-failure.png') : undefined,
  });
  if (!res.ok) {
    console.error(`✗ Login failed: ${res.errorType ?? ''} ${res.errorMessage ?? ''}`.trim());
    if (debug) console.error(`  A screenshot of the stuck page was saved to ${join(kesefDir(), 'last-failure.png')}`);
    process.exit(1);
  }
  const key = await getDbKey(false);
  const store = Store.open({ path: dbPath(), key });
  const { accounts, transactions, snapshots } = res.data!;
  const overrides = loadOverrides();
  for (const t of transactions) t.category = categorize(t.description, overrides);
  for (const a of accounts) store.upsertAccount(a);
  for (const t of transactions) store.upsertTransaction(t);
  for (const s of snapshots) store.upsertBalanceSnapshot(s);
  console.log(`✓ Synced ${accounts.length} account(s), ${transactions.length} transaction(s).`);
  console.log(`  Stored total: ${store.countTransactions()} transactions across ${store.countAccounts()} accounts.`);
  store.close();
}

async function status(): Promise<void> {
  const key = await getDbKey(false);
  const store = Store.open({ path: dbPath(), key });
  console.log(`${store.countAccounts()} account(s), ${store.countTransactions()} transaction(s) in ~/.kesef/kesef.db`);
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
const cmds: Record<string, () => Promise<void>> = { connect, sync, status, categorize: recategorize, 'add-balance': addBalance };
(cmds[cmd ?? ''] ?? (async () => { console.error('usage: connect | sync | status | categorize | add-balance'); process.exit(1); }))()
  .catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
