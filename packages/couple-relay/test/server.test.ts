import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createRelayServer } from '../src/server';

let stop: (() => Promise<void>) | null = null;
let dir = '';
afterEach(async () => { if (stop) await stop(); stop = null; if (dir) { rmSync(dir, { recursive: true, force: true }); dir = ''; } });

async function boot(dataFile?: string): Promise<string> {
  const r = createRelayServer(dataFile ? { dataFile } : {});
  stop = r.stop;
  await new Promise<void>(resolve => r.server.listen(0, '127.0.0.1', resolve));
  const port = (r.server.address() as AddressInfo).port;
  return `http://127.0.0.1:${port}`;
}
const send = (url: string, method: string, body?: unknown) =>
  fetch(url, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });

describe('relay server (real HTTP)', () => {
  it('PUT then GET round-trips an encrypted blob over the wire', async () => {
    const base = await boot();
    const blob = { iv: 'aXY=', tag: 'dGFn', ciphertext: 'Y2lwaGVydGV4dA==' };
    expect((await send(`${base}/v1/blob/pairZ/A`, 'PUT', { seq: 1, blob })).status).toBe(200);
    const body = await (await send(`${base}/v1/blob/pairZ`, 'GET')).json();
    expect(body.A.blob).toEqual(blob);
    expect(body.B).toBeNull();
  });

  it('persists only ciphertext to disk — a hand-inspection finds the opaque blob, nothing readable', async () => {
    dir = mkdtempSync(join(tmpdir(), 'relay-'));
    const dataFile = join(dir, 'relay.json');
    const base = await boot(dataFile);
    const blob = { iv: 'aXY=', tag: 'dGFn', ciphertext: 'Y2lwaGVydGV4dA==' };
    await send(`${base}/v1/blob/pairZ/A`, 'PUT', { seq: 1, blob });
    const onDisk = readFileSync(dataFile, 'utf8');
    expect(onDisk).toContain('Y2lwaGVydGV4dA=='); // stored verbatim, opaque
    expect(JSON.parse(onDisk).pairZ.A.seq).toBe(1);
  });

  it('rejects a stale seq with 409 over the wire', async () => {
    const base = await boot();
    const blob = { ciphertext: 'x' };
    await send(`${base}/v1/blob/p/A`, 'PUT', { seq: 5, blob });
    expect((await send(`${base}/v1/blob/p/A`, 'PUT', { seq: 5, blob })).status).toBe(409);
  });

  it('GET /v1/health is alive', async () => {
    const base = await boot();
    expect((await send(`${base}/v1/health`, 'GET')).status).toBe(200);
  });
});
