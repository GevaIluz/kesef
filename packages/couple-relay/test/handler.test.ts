import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { handleRelay, MAX_BLOB_BYTES } from '../src/handler';
import { RelayStore } from '../src/store';

const blob = { iv: 'aXY=', tag: 'dGFn', ciphertext: 'Y2lwaGVy' };
const put = (store: RelayStore, pid: string, slot: string, seq: number, b: unknown = blob, now = 't') =>
  handleRelay({ method: 'PUT', path: `/v1/blob/${pid}/${slot}`, body: { schema: 'kesef.couple.blob/v1', seq, blob: b }, now }, store);

describe('handleRelay — HTTP routing over the opaque store', () => {
  it('GET /v1/health returns 200 and no data', () => {
    const r = handleRelay({ method: 'GET', path: '/v1/health', now: 't' }, new RelayStore());
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true });
  });

  it('PUT then GET round-trips the blob verbatim into its slot', () => {
    const store = new RelayStore();
    expect(put(store, 'p1', 'A', 1)).toEqual({ status: 200, json: { ok: true, seq: 1 } });
    const r = handleRelay({ method: 'GET', path: '/v1/blob/p1', now: 't' }, store);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ A: { seq: 1, blob }, B: null });
  });

  it('PUT with a stale seq returns 409', () => {
    const store = new RelayStore();
    put(store, 'p', 'A', 5);
    expect(put(store, 'p', 'A', 5).status).toBe(409);
    expect(put(store, 'p', 'A', 4).status).toBe(409);
  });

  it('PUT of an oversized blob returns 413 and stores nothing', () => {
    const store = new RelayStore();
    const huge = { ciphertext: 'x'.repeat(MAX_BLOB_BYTES + 10) };
    expect(put(store, 'p', 'A', 1, huge).status).toBe(413);
    expect(handleRelay({ method: 'GET', path: '/v1/blob/p', now: 't' }, store).json).toEqual({ A: null, B: null });
  });

  it('PUT validates the slot and body shape (400)', () => {
    const store = new RelayStore();
    expect(put(store, 'p', 'C', 1).status).toBe(400);                                   // bad slot
    expect(handleRelay({ method: 'PUT', path: '/v1/blob/p/A', body: { blob }, now: 't' }, store).status).toBe(400); // no seq
    expect(handleRelay({ method: 'PUT', path: '/v1/blob/p/A', body: { seq: 1 }, now: 't' }, store).status).toBe(400); // no blob
  });

  it('GET returns both slots; DELETE forgets them', () => {
    const store = new RelayStore();
    put(store, 'p', 'A', 1);
    put(store, 'p', 'B', 2);
    expect(handleRelay({ method: 'GET', path: '/v1/blob/p', now: 't' }, store).json).toMatchObject({ A: { seq: 1 }, B: { seq: 2 } });
    expect(handleRelay({ method: 'DELETE', path: '/v1/blob/p', now: 't' }, store)).toEqual({ status: 200, json: { ok: true } });
    expect(handleRelay({ method: 'GET', path: '/v1/blob/p', now: 't' }, store).json).toEqual({ A: null, B: null });
  });

  it('unknown route returns 404', () => {
    expect(handleRelay({ method: 'GET', path: '/v1/whatever', now: 't' }, new RelayStore()).status).toBe(404);
  });
});

describe('relay isolation invariant', () => {
  it('no relay source file imports the finance code (@kesef/*)', () => {
    const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
    for (const f of readdirSync(srcDir).filter(n => n.endsWith('.ts'))) {
      const code = readFileSync(join(srcDir, f), 'utf8');
      expect(code, `${f} must not import finance code`).not.toMatch(/@kesef\//);
    }
  });
});
