// Pure HTTP routing for the relay: (method, path, body) -> (status, json). No sockets here, so it's
// fully unit-testable. Auth model is capability-URL: the pairingId in the path IS the bearer secret;
// since blobs are useless without S_pair (which the relay never holds), a guessed id reveals nothing.
import { RelayStore, type Slot } from './store';

export const MAX_BLOB_BYTES = 64 * 1024; // 64 KiB ceiling per slot

export interface RelayRequest { method: string; path: string; body?: unknown; now: string }
export interface RelayResponse { status: number; json: unknown }

const isSlot = (s: string): s is Slot => s === 'A' || s === 'B';

export function handleRelay(req: RelayRequest, store: RelayStore): RelayResponse {
  const parts = req.path.split('/').filter(Boolean); // ['v1','blob','<pairingId>','<slot>']
  const method = req.method.toUpperCase();

  if (method === 'GET' && parts.length === 2 && parts[0] === 'v1' && parts[1] === 'health') {
    return { status: 200, json: { ok: true } };
  }

  if (parts[0] === 'v1' && parts[1] === 'blob') {
    const pairingId = parts[2];
    if (!pairingId) return { status: 404, json: { error: 'not found' } };

    if (method === 'PUT') {
      const slot = parts[3];
      if (!slot || !isSlot(slot)) return { status: 400, json: { error: 'slot must be A or B' } };
      const body = (req.body && typeof req.body === 'object') ? req.body as Record<string, unknown> : {};
      const seq = body['seq'];
      if (typeof seq !== 'number' || !Number.isFinite(seq)) return { status: 400, json: { error: 'numeric seq required' } };
      if (body['blob'] === undefined || body['blob'] === null) return { status: 400, json: { error: 'blob required' } };
      if (Buffer.byteLength(JSON.stringify(body['blob']), 'utf8') > MAX_BLOB_BYTES) {
        return { status: 413, json: { error: 'blob too large' } };
      }
      const res = store.put(pairingId, slot, seq, body['blob'], req.now);
      return res.ok
        ? { status: 200, json: { ok: true, seq: res.seq } }
        : { status: 409, json: { error: 'stale seq' } };
    }

    if (method === 'GET') return { status: 200, json: store.get(pairingId) };
    if (method === 'DELETE') { store.del(pairingId); return { status: 200, json: { ok: true } }; }
  }

  return { status: 404, json: { error: 'not found' } };
}
