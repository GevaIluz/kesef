import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { Store, InMemoryVault } from '@kesef/core';
import type { Account, BalanceSnapshot, Goal, Transaction } from '@kesef/core';
import { createRelayServer } from '../../couple-relay/src/server';
import { pairGenerate, pairJoin, syncWithPartner } from '../src/coupleSync';

// --- test fixtures: two independent "devices", each with its own store + keychain ---
const dirs: string[] = [];
const stores: Store[] = [];
let relayStop: (() => Promise<void>) | null = null;
let base = '';

function tmpStore(): Store {
  const d = mkdtempSync(join(tmpdir(), 'kesef-cs-'));
  dirs.push(d);
  const s = Store.open({ path: join(d, 'db'), key: 'k' });
  stores.push(s);
  return s;
}
const acct = (o: Partial<Account> & { id: string }): Account =>
  ({ institution: 'beinleumi', type: 'bank', displayName: o.id, currency: 'ILS', shareable: false, ...o });
const snap = (accountId: string, balance: number, date = '2026-06-01'): BalanceSnapshot =>
  ({ id: `${accountId}@${date}`, accountId, date, balance });

beforeEach(async () => {
  const r = createRelayServer({});
  relayStop = r.stop;
  await new Promise<void>(res => r.server.listen(0, '127.0.0.1', res));
  base = `http://127.0.0.1:${(r.server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  if (relayStop) await relayStop(); relayStop = null;
  for (const s of stores.splice(0)) s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('couple sync — two devices, zero-knowledge relay', () => {
  function seedGuy(s: Store) {
    s.upsertAccount(acct({ id: 'gbank', type: 'bank', displayName: 'Guy checking', shareable: true }));
    s.upsertAccount(acct({ id: 'gcard', institution: 'cal', type: 'credit_card', displayName: 'Guy card', shareable: false }));
    s.upsertBalanceSnapshot(snap('gbank', 42200));
    s.upsertBalanceSnapshot(snap('gcard', -3000));
    s.upsertTransaction({ id: 'gx1', accountId: 'gcard', date: '2026-06-02', amount: -800, description: 'PRIVATE-THERAPY', category: 'health' });
    s.upsertGoal({ id: 'gg', name: 'Apartment', targetAmount: 600000, currentAmount: 100000, shareable: true });
  }
  function seedPartner(s: Store) {
    s.upsertAccount(acct({ id: 'pibi', institution: 'ibi', type: 'investment', displayName: 'IBI', shareable: true }));
    s.upsertAccount(acct({ id: 'pbank', type: 'bank', displayName: 'Her private bank', shareable: false }));
    s.upsertBalanceSnapshot(snap('pibi', 54000, '2026-06-02'));
    s.upsertBalanceSnapshot(snap('pbank', 99999));
    s.upsertGoal({ id: 'pg', name: 'Camera', targetAmount: 8000, currentAmount: 3000, shareable: true });
  }

  it('merges only shared items across two devices on the SAME institutions; private items never appear', async () => {
    const A = tmpStore(); seedGuy(A);
    const B = tmpStore(); seedPartner(B);
    const vaultA = new InMemoryVault();
    const vaultB = new InMemoryVault();

    const { token } = await pairGenerate(A, vaultA, { relayUrl: base, partnerLabel: 'Partner', now: '2026-06-04' });
    await pairJoin(B, vaultB, { token, relayUrl: base, partnerLabel: 'Guy', now: '2026-06-04' });

    // A syncs first: uploads its summary, partner slot still empty
    const a1 = await syncWithPartner(A, vaultA, '2026-06-04');
    expect(a1.partner).toBeNull();
    expect(a1.mine.netWorth.total).toBe(42200); // gbank only (gcard private)

    // B syncs: uploads its own, reads A's
    const b1 = await syncWithPartner(B, vaultB, '2026-06-04');
    expect(b1.partner).not.toBeNull();
    expect(b1.model!.netWorth.me).toBe(54000);      // B's shared (pibi)
    expect(b1.model!.netWorth.partner).toBe(42200); // A's shared (gbank)

    // A syncs again: now reads B's blob
    const a2 = await syncWithPartner(A, vaultA, '2026-06-04');
    expect(a2.partner).not.toBeNull();
    expect(a2.model!.netWorth).toMatchObject({ me: 42200, partner: 54000, total: 96200 });

    // owner-tagged accounts: both partners' holdings are distinct (same institutions, different savings)
    const labels = a2.model!.accounts.map(x => `${x.owner}:${x.label}`);
    expect(labels).toContain('me:Guy checking');
    expect(labels).toContain('partner:IBI');
    // partner's PRIVATE bank (₪99999) never crosses over
    expect(a2.model!.accounts.some(x => x.balance === 99999 || x.label === 'Her private bank')).toBe(false);

    // shared goals union, tagged by owner
    const goals = a2.model!.goals.map(g => `${g.owner}:${g.name}`);
    expect(goals).toEqual(expect.arrayContaining(['me:Apartment', 'partner:Camera']));
  });

  it('reports a tampered partner blob instead of trusting it', async () => {
    const A = tmpStore(); seedGuy(A);
    const B = tmpStore(); seedPartner(B);
    const vaultA = new InMemoryVault(); const vaultB = new InMemoryVault();
    const { token } = await pairGenerate(A, vaultA, { relayUrl: base, partnerLabel: 'Partner', now: '2026-06-04' });
    const pairing = await pairJoin(B, vaultB, { token, relayUrl: base, partnerLabel: 'Guy', now: '2026-06-04' });
    await syncWithPartner(B, vaultB, '2026-06-04'); // B uploads a real blob to slot B

    // overwrite slot B with authentic-looking garbage at a higher seq (a malicious/broken relay)
    await fetch(`${base}/v1/blob/${pairing.pairingId}/B`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seq: 999, blob: { iv: 'AAAAAAAAAAAAAAAA', tag: 'AAAAAAAAAAAAAAAAAAAAAA==', ciphertext: 'AAAA' } }),
    });

    const a = await syncWithPartner(A, vaultA, '2026-06-04');
    expect(a.partner).toBeNull();
    expect(a.partnerError).toBeTruthy();
  });

  it('refuses a non-https relay (except localhost) and errors when unpaired', async () => {
    const A = tmpStore(); seedGuy(A);
    const vaultA = new InMemoryVault();
    await expect(syncWithPartner(A, vaultA, '2026-06-04')).rejects.toThrow(/not paired/i);
    await pairGenerate(A, vaultA, { relayUrl: 'http://evil.example.com', partnerLabel: 'x', now: '2026-06-04' });
    await expect(syncWithPartner(A, vaultA, '2026-06-04')).rejects.toThrow(/https/i);
  });
});
