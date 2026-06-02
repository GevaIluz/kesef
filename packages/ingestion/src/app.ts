import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { KeyringVault, Store, buildDashboard } from '@kesef/core';
import { dbPath } from './paths.js';

const vault = new KeyringVault('kesef');
const webDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const port = Number(process.env.PORT) || 8750;

async function dbKey(): Promise<string> {
  const k = await vault.get('db-key');
  if (!k) throw new Error('No data yet — run `npm run sync` first.');
  return k;
}

function buildModel(key: string) {
  const store = Store.open({ path: dbPath(), key });
  try {
    return buildDashboard(
      store.listAccounts(), store.allTransactions(), store.allBalanceSnapshots(),
      new Date().toISOString().slice(0, 10),
    );
  } finally { store.close(); }
}

createServer(async (req, res) => {
  try {
    if ((req.url || '/').split('?')[0] !== '/') { res.writeHead(404); res.end('not found'); return; }
    const model = buildModel(await dbKey());
    // Inject the model. Escape `<` so a merchant name can't break out of the <script>; use a function
    // replacement so `$` in the JSON isn't treated as a replacement pattern.
    const json = JSON.stringify(model).replace(/</g, '\\u003c');
    const html = readFileSync(join(webDir, 'dashboard.html'), 'utf8')
      .replace('/*__KESEF_DATA__*/ null', () => json);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(e instanceof Error ? e.message : 'error');
  }
}).listen(port, () => console.log(`kesef dashboard → http://localhost:${port}  (Ctrl-C to stop)`));
