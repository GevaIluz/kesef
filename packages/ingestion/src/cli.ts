import { randomBytes } from 'node:crypto';
import { KeyringVault, Store } from '@kesef/core';
import { dbPath } from './paths.js';
import { ask, askHidden } from './prompt.js';
import { scrapeBeinleumi } from './beinleumi.js';

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
  console.log('Logging in to Beinleumi…');
  const res = await scrapeBeinleumi({ username, password }, { now: todayISO() });
  if (!res.ok) { console.error(`✗ Login failed: ${res.errorType ?? ''} ${res.errorMessage ?? ''}`.trim()); process.exit(1); }
  const key = await getDbKey(false);
  const store = Store.open({ path: dbPath(), key });
  const { accounts, transactions, snapshots } = res.data!;
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

const cmd = process.argv[2];
const cmds: Record<string, () => Promise<void>> = { connect, sync, status };
(cmds[cmd ?? ''] ?? (async () => { console.error('usage: connect | sync | status'); process.exit(1); }))()
  .catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
