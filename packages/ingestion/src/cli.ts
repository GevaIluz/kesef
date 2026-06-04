import { randomBytes } from 'node:crypto';
import { CompanyTypes } from 'israeli-bank-scrapers';
import { KeyringVault, Store } from '@kesef/core';
import { join } from 'node:path';
import { dbPath, kesefDir } from './paths.js';
import { ask } from './prompt.js';
import { scrapeInteractive } from './interactive.js';
import { categorize, assignCategory } from './categorize.js';
import { loadOverrides } from './overrides.js';
import { manualAccountFor } from './manualAccounts.js';
import { loadIbiConfig, saveIbiConfig } from './ibiConfig.js';

const vault = new KeyringVault('kesef');
const todayISO = () => new Date().toISOString().slice(0, 10);

async function getDbKey(create: boolean): Promise<string> {
  let k = await vault.get('db-key');
  if (!k && create) { k = randomBytes(32).toString('hex'); await vault.set('db-key', k); }
  if (!k) throw new Error('No data yet — run `npm run sync` first.');
  return k;
}

async function connect(): Promise<void> {
  // kesef no longer stores bank passwords — you log in through the browser on `sync`.
  // Clear any credentials saved by older versions, for hygiene.
  for (const k of ['creds:beinleumi', 'creds:cal', 'beinleumi']) await vault.delete(k);
  console.log('kesef now logs you in through the browser — there are no passwords to keep here.');
  console.log('Just run `npm run sync`: a browser opens for each account and you log in yourself.');
}

async function sync(): Promise<void> {
  const debug = !!process.env.KESEF_DEBUG;
  const overrides = loadOverrides();
  const now = todayISO();
  const targets = [
    { companyId: CompanyTypes.beinleumi, institution: 'beinleumi' as const, accountType: 'bank' as const, label: 'Beinleumi' },
    { companyId: CompanyTypes.visaCal, institution: 'cal' as const, accountType: 'credit_card' as const, label: 'Cal' },
  ];

  // db-key is a LOCAL encryption key (not a bank credential); created on first run.
  const key = await getDbKey(true);
  const store = Store.open({ path: dbPath(), key });
  // Drop any bank passwords saved by older versions — interactive login never stores them.
  for (const k of ['creds:beinleumi', 'creds:cal', 'beinleumi']) await vault.delete(k);

  console.log('A browser window opens for each account — log in there yourself (nothing to type in this terminal).');
  for (const t of targets) {
    console.log(`\nOpening ${t.label} — log in in the browser window…`);
    const res = await scrapeInteractive(
      { companyId: t.companyId, institution: t.institution, accountType: t.accountType },
      { now, verbose: debug, failureScreenshotPath: debug ? join(kesefDir(), `last-failure-${t.institution}.png`) : undefined },
    );
    if (!res.ok) { console.error(`✗ ${t.label} failed: ${res.errorType ?? ''} ${res.errorMessage ?? ''}`.trim()); continue; }
    const { accounts, transactions, snapshots } = res.data!;
    for (const tx of transactions) tx.category = assignCategory(tx, overrides);
    for (const a of accounts) store.upsertAccount(a);
    for (const tx of transactions) store.upsertTransaction(tx);
    for (const s of snapshots) store.upsertBalanceSnapshot(s);
    console.log(`  ✓ ${t.label}: ${accounts.length} account(s), ${transactions.length} transaction(s).`);
  }
  console.log(`\nStored total: ${store.countTransactions()} transactions across ${store.countAccounts()} accounts.`);
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
    t.category = assignCategory(t, overrides); // honors card rawCategory + description rules
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

// Interactive IBI reader: you log in yourself (no creds stored), then CLICK your portfolio total once.
// kesef captures that number + remembers where it is, so next time it reads it automatically.
async function syncIbi(): Promise<void> {
  const choice = (await ask('IBI portal — [1] My Capital (managed)  [2] Capital Expert  [3] SPARK / Trade  [4] custom URL  (default 1): ')).trim();
  const url = choice === '2' ? 'https://capitalexpert.ibi.co.il/login'
    : choice === '3' ? 'https://sparkibi.ordernet.co.il/#/auth'
    : choice === '4' ? ((await ask('Portal URL: ')).trim() || 'https://mycapital.ibi.co.il')
    : (process.env.KESEF_IBI_URL || 'https://mycapital.ibi.co.il');

  const cfg = loadIbiConfig();
  const saved = cfg.url === url ? cfg.selector : undefined;
  console.log('\nA browser will open to IBI. Log in yourself — kesef never sees your credentials.');
  console.log('Open the screen that shows your portfolio total.');
  if (saved) console.log('(I’ll try to read your saved total automatically first.)');

  const { readIbiTotal } = await import('./ibi.js');
  const res = await readIbiTotal({
    url,
    savedSelector: saved,
    waitForLogin: () => ask('\n→ Logged in with your portfolio total on screen? Press Enter… '),
    promptClick: () => console.log('→ Now CLICK your portfolio total in the browser (click right on the ₪ number).'),
  });

  let total = res.value;
  if (total === null) {
    const manual = (await ask('Didn’t capture a number. Type your IBI total in ₪ (blank = cancel): ')).replace(/[, ]/g, '');
    if (!manual) { console.error('Cancelled — nothing recorded.'); process.exit(1); }
    total = Number(manual);
    if (!Number.isFinite(total)) { console.error('Not a number.'); process.exit(1); }
  } else if (res.mode === 'auto') {
    console.log(`\nRead automatically: ₪${total.toLocaleString('en-US')}`);
  } else {
    console.log(`\nCaptured: ₪${total.toLocaleString('en-US')}  (from "${res.rawText}")`);
    if (res.selector) { saveIbiConfig({ url, selector: res.selector }); console.log('✓ Saved where it lives — next time it reads automatically, no clicking.'); }
  }

  const spec = manualAccountFor('ibi');
  const date = todayISO();
  const key = await getDbKey(true);
  const store = Store.open({ path: dbPath(), key });
  store.upsertAccount({ id: spec.id, institution: spec.institution, type: spec.type, displayName: spec.displayName, currency: 'ILS', shareable: false });
  store.upsertBalanceSnapshot({ id: `${spec.id}@${date}`, accountId: spec.id, date, balance: total });
  console.log(`✓ Recorded IBI portfolio: ₪${total.toLocaleString('en-US')} on ${date}`);
  store.close();
}

const cmd = process.argv[2];
const cmds: Record<string, () => Promise<void>> = { connect, sync, status, categorize: recategorize, 'add-balance': addBalance, 'sync-ibi': syncIbi, list };
(cmds[cmd ?? ''] ?? (async () => { console.error('usage: connect | sync | sync-ibi | status | categorize | add-balance | list'); process.exit(1); }))()
  .catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
