// Thin HTTP transport around the pure handler. Plain HTTP by design — deploy behind TLS 1.2+
// (Caddy/Let's Encrypt or a tunnel). Stores ciphertext only; optional JSON persistence for self-hosting.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RelayStore } from './store';
import { handleRelay } from './handler';

const MAX_BODY = 128 * 1024;                 // hard cap on any request body (handler caps the blob at 64 KiB)
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

export interface RelayServerOptions {
  dataFile?: string;        // optional JSON persistence path (kept mode 600)
  ttlDays?: number;         // purge pairings idle longer than this (default 30)
  now?: () => string;       // injectable clock for tests
}

export function createRelayServer(opts: RelayServerOptions = {}) {
  const now = opts.now ?? (() => new Date().toISOString());
  const store = opts.dataFile && existsSync(opts.dataFile)
    ? RelayStore.from(JSON.parse(readFileSync(opts.dataFile, 'utf8')))
    : new RelayStore();

  const persist = (): void => {
    if (!opts.dataFile) return;
    mkdirSync(dirname(opts.dataFile), { recursive: true });
    writeFileSync(opts.dataFile, JSON.stringify(store.dump()), { mode: 0o600 });
  };

  const server = createServer((req, res) => {
    const chunks: Buffer[] = []; let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { res.writeHead(413, JSON_HEADERS); res.end('{"error":"body too large"}'); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      let body: unknown;
      try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined; }
      catch { res.writeHead(400, JSON_HEADERS); res.end('{"error":"invalid json"}'); return; }
      const method = req.method ?? 'GET';
      const path = new URL(req.url || '/', 'http://relay').pathname;
      const out = handleRelay({ method, path, body, now: now() }, store);
      if ((method === 'PUT' || method === 'DELETE') && out.status < 400) persist();
      res.writeHead(out.status, JSON_HEADERS);
      res.end(JSON.stringify(out.json));
    });
    req.on('error', () => { if (!res.writableEnded) { res.writeHead(400, JSON_HEADERS); res.end('{"error":"bad request"}'); } });
  });

  const ttlMs = (opts.ttlDays ?? 30) * 24 * 60 * 60 * 1000;
  const sweep = setInterval(() => {
    const cutoff = new Date(Date.parse(now()) - ttlMs).toISOString();
    if (store.purge(cutoff) > 0) persist();
  }, 60 * 60 * 1000);
  sweep.unref();

  return {
    server,
    store,
    persist,
    stop: (): Promise<void> => { clearInterval(sweep); return new Promise<void>(resolve => server.close(() => resolve())); },
  };
}

// CLI entry: `tsx src/server.ts` (or `npm run relay`). Binds 127.0.0.1 by default; set HOST=0.0.0.0
// behind a TLS-terminating proxy to expose it. KESEF_RELAY_DATA enables on-disk persistence.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8790;
  const host = process.env.HOST || '127.0.0.1';
  const dataFile = process.env.KESEF_RELAY_DATA || undefined;
  const { server } = createRelayServer({ dataFile });
  server.listen(port, host, () => console.log(`kesef couple-relay → http://${host}:${port}  (stores ciphertext only)`));
}
