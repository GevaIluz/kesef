// Ciphertext-only blob store for the couple relay. It keeps exactly two slots (A/B) per pairing and
// NEVER inspects a blob — to the relay a blob is opaque bytes. There are no finance imports here by
// design: this package can be built, audited and deployed in complete isolation from the finance code.

export type Slot = 'A' | 'B';
export type OpaqueBlob = unknown; // the relay never parses this

export interface StoredSlot { seq: number; blob: OpaqueBlob; updatedAt: string }
export interface PairingSlots { A: StoredSlot | null; B: StoredSlot | null }
export type PutResult = { ok: true; seq: number } | { ok: false; reason: 'stale' };

export class RelayStore {
  private pairings = new Map<string, { A: StoredSlot | null; B: StoredSlot | null }>();

  /** Upload a blob to a slot. Rejects a seq <= the stored seq (replay/stale ⇒ caller returns 409). */
  put(pairingId: string, slot: Slot, seq: number, blob: OpaqueBlob, now: string): PutResult {
    let p = this.pairings.get(pairingId);
    if (!p) { p = { A: null, B: null }; this.pairings.set(pairingId, p); }
    const existing = p[slot];
    if (existing && seq <= existing.seq) return { ok: false, reason: 'stale' };
    p[slot] = { seq, blob, updatedAt: now };
    return { ok: true, seq };
  }

  /** Read both slots. An unknown pairing reads as two empty slots (capability model). */
  get(pairingId: string): PairingSlots {
    const p = this.pairings.get(pairingId);
    return { A: p?.A ?? null, B: p?.B ?? null };
  }

  /** Forget both slots of a pairing (revocation / disconnect). */
  del(pairingId: string): void { this.pairings.delete(pairingId); }

  /** TTL purge: drop pairings whose most-recent slot update is strictly before `cutoff` (ISO). */
  purge(cutoff: string): number {
    let removed = 0;
    for (const [id, p] of this.pairings) {
      const newest = [p.A?.updatedAt, p.B?.updatedAt].filter((x): x is string => !!x).sort().pop();
      if (!newest || newest < cutoff) { this.pairings.delete(id); removed++; }
    }
    return removed;
  }

  /** Serialize the whole store (opaque blobs included) for on-disk persistence. */
  dump(): Record<string, PairingSlots> {
    return Object.fromEntries(this.pairings);
  }

  /** Rebuild a store from a previous dump() (e.g. on relay boot). */
  static from(data: Record<string, PairingSlots> | null | undefined): RelayStore {
    const s = new RelayStore();
    for (const [id, slots] of Object.entries(data ?? {})) {
      s.pairings.set(id, { A: slots?.A ?? null, B: slots?.B ?? null });
    }
    return s;
  }
}
