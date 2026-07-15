// Couple sync client — the glue that turns the local store into an encrypted summary, exchanges it
// through the zero-knowledge relay, and merges the partner's summary back into a couple view.
//
// Privacy/security invariants enforced here:
//   - The only secret (S_pair) lives in the OS keychain, keyed by pairingId; never on disk, never logged.
//   - Confidentiality + integrity are entirely client-side (AES-256-GCM via core); the relay sees ciphertext.
//   - Refuse a non-TLS relay (localhost http allowed only for dev).
import { Buffer } from 'node:buffer';
import {
  buildShareableSummary, buildCoupleModel,
  deriveCoupleKeys, sealCoupleBlob, openCoupleBlob,
  newPairing, makePairingToken, parsePairingToken,
} from '@kesef/core';
import type { Store, SecretVault, CouplePairing, CoupleSummary, CoupleModel, EncryptedBlob } from '@kesef/core';

const COUPLE_BLOB_SCHEMA = 'kesef.couple.blob/v1';
const keychainAccount = (pairingId: string) => `couple:S_pair:${pairingId}`;
const normalizeRelayUrl = (url: string) => url.replace(/\/+$/, '');

/** Refuse a non-TLS relay. http is permitted only for an explicit localhost dev relay. */
function assertRelayUrl(url: string): void {
  let u: URL;
  try { u = new URL(url); } catch { throw new Error('invalid relay URL'); }
  if (u.protocol === 'https:') return;
  if (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')) return;
  throw new Error('relay URL must use https (http allowed only for localhost dev)');
}

// --- relay HTTP client (capability-URL: pairingId is the bearer; data is E2E-encrypted) ---
interface SlotData { seq: number; blob: EncryptedBlob; updatedAt: string }
interface RelaySlots { A: SlotData | null; B: SlotData | null }

async function relayPut(relayUrl: string, pairingId: string, slot: 'A' | 'B', seq: number, blob: EncryptedBlob): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(`${relayUrl}/v1/blob/${pairingId}/${slot}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ schema: COUPLE_BLOB_SCHEMA, seq, blob }),
  });
  return { ok: res.ok, status: res.status };
}
async function relayGet(relayUrl: string, pairingId: string): Promise<RelaySlots> {
  const res = await fetch(`${relayUrl}/v1/blob/${pairingId}`);
  if (!res.ok) throw new Error(`relay GET failed (${res.status})`);
  return await res.json() as RelaySlots;
}

// --- pairing (key custody) ---
export interface PairOpts { relayUrl: string; partnerLabel?: string; now: string }

/** Initiator: mint a fresh secret, stash it in the keychain, return the QR/text token to show the partner. */
export async function pairGenerate(store: Store, vault: SecretVault, opts: PairOpts): Promise<{ token: string; pairing: CouplePairing }> {
  const p = newPairing();
  await vault.set(keychainAccount(p.pairingId), p.sPair.toString('hex'));
  const pairing: CouplePairing = {
    pairingId: p.pairingId, role: 'A',
    ...(opts.partnerLabel ? { partnerLabel: opts.partnerLabel } : {}),
    relayUrl: normalizeRelayUrl(opts.relayUrl), createdAt: opts.now, localSeq: 0, partnerSeq: 0,
  };
  store.setPairing(pairing);
  return { token: makePairingToken(p), pairing };
}

/** Joiner: scan/paste the partner's token, derive the same secret, stash it, take slot B. */
export async function pairJoin(store: Store, vault: SecretVault, opts: PairOpts & { token: string }): Promise<CouplePairing> {
  const p = parsePairingToken(opts.token.trim());
  await vault.set(keychainAccount(p.pairingId), p.sPair.toString('hex'));
  const pairing: CouplePairing = {
    pairingId: p.pairingId, role: 'B',
    ...(opts.partnerLabel ? { partnerLabel: opts.partnerLabel } : {}),
    relayUrl: normalizeRelayUrl(opts.relayUrl), createdAt: opts.now, localSeq: 0, partnerSeq: 0,
  };
  store.setPairing(pairing);
  return pairing;
}

/** Disconnect: forget the keychain secret + local pairing, and best-effort tell the relay to purge. */
export async function unpair(store: Store, vault: SecretVault): Promise<void> {
  const p = store.getPairing();
  if (p) {
    try { await vault.delete(keychainAccount(p.pairingId)); } catch { /* best effort */ }
    if (p.relayUrl) {
      try { await fetch(`${normalizeRelayUrl(p.relayUrl)}/v1/blob/${p.pairingId}`, { method: 'DELETE' }); } catch { /* best effort */ }
    }
  }
  store.clearPairing();
}

/** Build exactly what would leave this device — for a "what your partner will see" preview (shareable only). */
export function buildMySummary(store: Store, now: string): CoupleSummary {
  const pairing = store.getPairing();
  return buildShareableSummary(
    store.listAccounts(), store.allTransactions(), store.allBalanceSnapshots(), store.listGoals(), now,
    {
      pairingId: pairing?.pairingId ?? 'preview',
      author: pairing?.role ?? 'A',
      overrides: store.categoryOverrides(), merchantRules: store.merchantRules(),
    },
  );
}

/** My FULL side of the couple view — private items INCLUDED. Sharing only gates what the partner sees,
 *  never what I see of my own money. This is what populates "me" in the couple/partner view. */
export function buildMyCoupleSide(store: Store, now: string): CoupleSummary {
  const pairing = store.getPairing();
  return buildShareableSummary(
    store.listAccounts(), store.allTransactions(), store.allBalanceSnapshots(), store.listGoals(), now,
    {
      pairingId: pairing?.pairingId ?? 'self',
      author: pairing?.role ?? 'A',
      overrides: store.categoryOverrides(), merchantRules: store.merchantRules(), includeAll: true,
    },
  );
}

/** Couple model from LOCAL data only (no relay, no pairing needed): my full side, partner empty.
 *  Always available so the couple view shows my own data instantly, even before a partner connects. */
export function localCoupleModel(store: Store, now: string): CoupleModel {
  return buildCoupleModel(buildMyCoupleSide(store, now), null);
}

export interface CoupleSyncResult {
  mine: CoupleSummary;
  partner: CoupleSummary | null;
  model: CoupleModel | null;
  partnerError?: string;
  partnerAsOf?: string;
}

/** One sync round: seal+upload my summary, fetch both slots, open+merge the partner's. */
export async function syncWithPartner(store: Store, vault: SecretVault, now: string): Promise<CoupleSyncResult> {
  const pairing = store.getPairing();
  if (!pairing) throw new Error('not paired — connect with your partner first');
  if (!pairing.relayUrl) throw new Error('no relay configured for this pairing');
  assertRelayUrl(pairing.relayUrl);
  const relayUrl = normalizeRelayUrl(pairing.relayUrl);

  const hex = await vault.get(keychainAccount(pairing.pairingId));
  if (!hex) throw new Error('pairing secret missing from keychain — re-pair to fix');
  const keys = deriveCoupleKeys(Buffer.from(hex, 'hex'));

  const mySlot = pairing.role;
  const partnerSlot: 'A' | 'B' = pairing.role === 'A' ? 'B' : 'A';

  // Two summaries: what I UPLOAD (shareable only — privacy boundary) vs. MY view side (full).
  const opts = { author: mySlot, overrides: store.categoryOverrides(), merchantRules: store.merchantRules() };
  const accts = store.listAccounts(), txns = store.allTransactions(), snaps = store.allBalanceSnapshots(), goals = store.listGoals();
  const mine = buildShareableSummary(accts, txns, snaps, goals, now, { ...opts, pairingId: pairing.pairingId });
  const myFull = buildShareableSummary(accts, txns, snaps, goals, now, { ...opts, pairingId: pairing.pairingId, includeAll: true });

  // seal + upload ONLY the shareable summary to my slot with the next monotonic seq
  const seq = pairing.localSeq + 1;
  const blob = sealCoupleBlob(mine, keys.dataKey, { pairingId: pairing.pairingId, slot: mySlot, seq });
  const put = await relayPut(relayUrl, pairing.pairingId, mySlot, seq, blob);
  if (!put.ok) throw new Error(`relay rejected the upload (${put.status})`);
  let next: CouplePairing = { ...pairing, localSeq: seq };
  store.setPairing(next);

  // fetch both slots; decrypt the partner's
  const slots = await relayGet(relayUrl, pairing.pairingId);
  const partnerData = partnerSlot === 'A' ? slots.A : slots.B;
  let partner: CoupleSummary | null = null;
  let partnerError: string | undefined;
  let partnerAsOf: string | undefined;

  if (partnerData) {
    if (partnerData.seq <= pairing.partnerSeq) {
      partnerError = 'partner data is stale (already have a newer version)';
    } else {
      try {
        partner = openCoupleBlob(partnerData.blob, keys.dataKey, { pairingId: pairing.pairingId, slot: partnerSlot, seq: partnerData.seq });
        partnerAsOf = partner.generatedAt;
        next = { ...next, partnerSeq: partnerData.seq };
        store.setPairing(next);
        // F2 — a couple net-worth point ONLY on a successful partner open; last sync of the day wins (date PK).
        store.upsertCoupleSnapshot({ date: now, mine: mine.netWorth.total, partner: partner.netWorth.total });
      } catch {
        partnerError = "couldn't read your partner's data (corrupted or from a different pairing)";
      }
    }
  }

  // my full side is always shown; partner merges in when present (null → partner side just shows 0)
  const model = buildCoupleModel(myFull, partner);
  const result: CoupleSyncResult = { mine, partner, model };
  if (partnerError) result.partnerError = partnerError;
  if (partnerAsOf) result.partnerAsOf = partnerAsOf;
  return result;
}
