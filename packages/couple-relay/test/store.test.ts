import { describe, it, expect } from 'vitest';
import { RelayStore } from '../src/store';

// The relay treats every blob as opaque bytes. These tests use a dummy object as the "blob";
// the store must keep it verbatim and never inspect it.
const blob = (n: number) => ({ iv: `iv${n}`, tag: `tag${n}`, ciphertext: `ct${n}` });

describe('RelayStore — opaque, per-slot blob store', () => {
  it('stores a blob in a slot and returns it verbatim from get()', () => {
    const s = new RelayStore();
    s.put('pair1', 'A', 1, blob(1), '2026-06-04T00:00:00Z');
    const got = s.get('pair1');
    expect(got.A).toEqual({ seq: 1, blob: blob(1), updatedAt: '2026-06-04T00:00:00Z' });
    expect(got.B).toBeNull();
  });

  it('an unknown pairing reads as two empty slots (capability model: anyone may read, nothing there)', () => {
    const s = new RelayStore();
    expect(s.get('nope')).toEqual({ A: null, B: null });
  });

  it('rejects a stale or equal seq (monotonic per slot), accepts a higher one', () => {
    const s = new RelayStore();
    expect(s.put('p', 'A', 5, blob(5), 't1')).toEqual({ ok: true, seq: 5 });
    expect(s.put('p', 'A', 5, blob(99), 't2')).toEqual({ ok: false, reason: 'stale' });
    expect(s.put('p', 'A', 4, blob(99), 't2')).toEqual({ ok: false, reason: 'stale' });
    expect(s.get('p').A!.blob).toEqual(blob(5)); // unchanged by the rejected writes
    expect(s.put('p', 'A', 6, blob(6), 't3')).toEqual({ ok: true, seq: 6 });
    expect(s.get('p').A!.blob).toEqual(blob(6));
  });

  it('keeps slots A and B independent', () => {
    const s = new RelayStore();
    s.put('p', 'A', 1, blob(1), 't');
    s.put('p', 'B', 9, blob(2), 't');
    const got = s.get('p');
    expect(got.A!.seq).toBe(1);
    expect(got.B!.seq).toBe(9);
  });

  it('del() forgets both slots of a pairing', () => {
    const s = new RelayStore();
    s.put('p', 'A', 1, blob(1), 't');
    s.put('p', 'B', 1, blob(2), 't');
    s.del('p');
    expect(s.get('p')).toEqual({ A: null, B: null });
  });

  it('purge() drops pairings whose newest slot is older than the cutoff, keeps fresh ones', () => {
    const s = new RelayStore();
    s.put('old', 'A', 1, blob(1), '2026-05-01T00:00:00Z');
    s.put('fresh', 'A', 1, blob(2), '2026-06-03T00:00:00Z');
    const removed = s.purge('2026-05-10T00:00:00Z'); // cutoff
    expect(removed).toBe(1);
    expect(s.get('old')).toEqual({ A: null, B: null });
    expect(s.get('fresh').A!.seq).toBe(1);
  });

  it('dump() / from() round-trips the whole store (for on-disk persistence)', () => {
    const s = new RelayStore();
    s.put('p', 'A', 3, blob(3), 't1');
    s.put('p', 'B', 1, blob(7), 't2');
    const restored = RelayStore.from(s.dump());
    expect(restored.get('p')).toEqual(s.get('p'));
  });
});
