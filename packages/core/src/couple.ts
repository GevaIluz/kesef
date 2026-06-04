// Couple-sharing: build the "shareable summary" — the ONLY thing that ever leaves a device.
// Invariant (load-bearing): no raw transaction (description/merchant/id/per-tx amount) appears here.
// Everything is filtered to effectively-shareable items, then aggregated.

import { hkdfSync, randomBytes } from 'node:crypto';
import type { Account, BalanceSnapshot, Goal, Transaction, CategoryCode } from './types';
import { summarize, shiftDays } from './analytics';
import { normalizeMerchant } from './merchant';
import { encrypt, decrypt, type EncryptedBlob } from './crypto';

export interface ShareAccount {
  type: Account['type'];
  label: string;          // the owner's display name for the account (they chose what it reveals)
  balance: number;
  asOf: string | null;    // date of the latest balance snapshot, or null if none
}

export const SUMMARY_SCHEMA = 'kesef.couple.summary/v1';

export interface ShareGoal {
  name: string;
  targetAmount: number;
  currentAmount: number;
  targetDate?: string;
}

/** Net-worth split that drives the "day-to-day vs long-term" framing (liquid = spendable, investment+retirement = long-term). */
export interface NetWorthBuckets { liquid: number; investment: number; retirement: number; liability: number }
export interface NetWorth { total: number; byBucket: NetWorthBuckets }

/** Map an account type to its net-worth bucket. */
function bucketOf(type: Account['type']): keyof NetWorthBuckets {
  switch (type) {
    case 'bank': return 'liquid';
    case 'investment': return 'investment';
    case 'pension': return 'retirement';
    case 'credit_card': return 'liability';
  }
}

/** Category TOTALS for one period — never line items. */
export interface SharePeriod {
  spent: number;
  byCategory: { category: CategoryCode | 'other'; amount: number }[];
}
export interface ShareSpending {
  thisMonth: SharePeriod;
  last30: SharePeriod;
  last90: SharePeriod;
  year: SharePeriod;
}

export interface CoupleSummary {
  schema: typeof SUMMARY_SCHEMA;
  pairingId: string;
  author: 'A' | 'B';      // stable per-device role label, NOT a real identity
  generatedAt: string;    // ISO date (coarse on purpose — no finer time)
  currency: 'ILS';
  netWorth: NetWorth;
  accounts: ShareAccount[];
  spending: ShareSpending;
  goals: ShareGoal[];
}

export interface BuildSummaryOpts {
  pairingId: string;
  author?: 'A' | 'B';
  overrides?: Map<string, string>;       // per-transaction category overrides (same as dashboard)
  merchantRules?: Map<string, string>;   // learned merchant→category rules (same as dashboard)
}

/** Latest balance snapshot per account (by date). */
function latestSnap(snaps: BalanceSnapshot[]): Map<string, { balance: number; date: string }> {
  const m = new Map<string, { balance: number; date: string }>();
  for (const s of snaps) {
    const prev = m.get(s.accountId);
    if (!prev || s.date > prev.date) m.set(s.accountId, { balance: s.balance, date: s.date });
  }
  return m;
}

export function buildShareableSummary(
  accounts: Account[],
  transactions: Transaction[],
  snapshots: BalanceSnapshot[],
  goals: Goal[],
  now: string,
  opts: BuildSummaryOpts,
): CoupleSummary {
  const latest = latestSnap(snapshots);
  const shareAccounts: ShareAccount[] = accounts
    .filter(a => a.shareable)
    .map(a => {
      const l = latest.get(a.id);
      return { type: a.type, label: a.displayName, balance: l ? l.balance : 0, asOf: l ? l.date : null };
    });

  // Spending = category TOTALS over the effectively-shareable transactions only.
  // Effective-shareable rule (privacy-dominant): the ACCOUNT must be shareable; within it a
  // transaction may opt out with shareable===false. A private account is fully private — a flagged
  // tx inside it never leaks. Category resolution mirrors the dashboard (override → merchant → assigned).
  const acctShareable = new Map(accounts.map(a => [a.id, a.shareable]));
  const overrides = opts.overrides ?? new Map<string, string>();
  const merchantRules = opts.merchantRules ?? new Map<string, string>();
  const shareableTxns: Transaction[] = transactions
    .filter(t => acctShareable.get(t.accountId) === true && t.shareable !== false)
    .map(t => {
      const byTxn = overrides.get(t.id) as CategoryCode | undefined;
      const byMerchant = merchantRules.get(normalizeMerchant(t.description)) as CategoryCode | undefined;
      return { ...t, category: byTxn ?? byMerchant ?? t.category };
    });
  const month = now.slice(0, 7);
  const inRange = (from: string) => shareableTxns.filter(t => t.date >= from && t.date <= now);
  const period = (txns: Transaction[]): SharePeriod => {
    const s = summarize(txns);
    return { spent: s.spent, byCategory: s.byCategory };
  };
  const spending: ShareSpending = {
    thisMonth: period(shareableTxns.filter(t => t.date.slice(0, 7) === month)),
    last30: period(inRange(shiftDays(now, -30))),
    last90: period(inRange(shiftDays(now, -90))),
    year: period(inRange(shiftDays(now, -365))),
  };
  const shareGoals: ShareGoal[] = goals
    .filter(g => g.shareable)
    .map(g => {
      const sg: ShareGoal = { name: g.name, targetAmount: g.targetAmount, currentAmount: g.currentAmount };
      if (g.targetDate) sg.targetDate = g.targetDate;
      return sg;
    });
  const byBucket: NetWorthBuckets = { liquid: 0, investment: 0, retirement: 0, liability: 0 };
  for (const a of shareAccounts) byBucket[bucketOf(a.type)] += a.balance;
  const total = byBucket.liquid + byBucket.investment + byBucket.retirement + byBucket.liability;
  return {
    schema: SUMMARY_SCHEMA,
    pairingId: opts.pairingId,
    author: opts.author ?? 'A',
    generatedAt: now,
    currency: 'ILS',
    netWorth: { total, byBucket },
    accounts: shareAccounts,
    spending,
    goals: shareGoals,
  };
}

// ---------------------------------------------------------------------------
// Couple view: merge MY summary with my PARTNER's into one model the dashboard
// renders. Each item is tagged by owner ('me' | 'partner') so two partners on
// the SAME institutions (e.g. both at IBI) with DIFFERENT balances stay
// distinct — and also roll up into combined totals.
// ---------------------------------------------------------------------------

export type Owner = 'me' | 'partner';
export type OwnedAccount = ShareAccount & { owner: Owner };
export type OwnedGoal = ShareGoal & { owner: Owner };

export interface CoupleModel {
  netWorth: { total: number; me: number; partner: number; byBucket: NetWorthBuckets };
  accounts: OwnedAccount[];
  spending: ShareSpending;
  goals: OwnedGoal[];
}

/** Merge two periods: sum spend, sum per-category totals, sort categories by amount desc. */
function mergePeriod(a: SharePeriod, b: SharePeriod): SharePeriod {
  const cat = new Map<string, number>();
  for (const c of [...a.byCategory, ...b.byCategory]) cat.set(c.category, (cat.get(c.category) ?? 0) + c.amount);
  const byCategory = [...cat.entries()]
    .map(([category, amount]) => ({ category: category as SharePeriod['byCategory'][number]['category'], amount }))
    .sort((x, y) => y.amount - x.amount);
  return { spent: a.spent + b.spent, byCategory };
}

export function buildCoupleModel(mine: CoupleSummary, partner: CoupleSummary): CoupleModel {
  const byBucket: NetWorthBuckets = {
    liquid: mine.netWorth.byBucket.liquid + partner.netWorth.byBucket.liquid,
    investment: mine.netWorth.byBucket.investment + partner.netWorth.byBucket.investment,
    retirement: mine.netWorth.byBucket.retirement + partner.netWorth.byBucket.retirement,
    liability: mine.netWorth.byBucket.liability + partner.netWorth.byBucket.liability,
  };
  return {
    netWorth: {
      total: mine.netWorth.total + partner.netWorth.total,
      me: mine.netWorth.total,
      partner: partner.netWorth.total,
      byBucket,
    },
    accounts: [
      ...mine.accounts.map((a): OwnedAccount => ({ owner: 'me', ...a })),
      ...partner.accounts.map((a): OwnedAccount => ({ owner: 'partner', ...a })),
    ],
    spending: {
      thisMonth: mergePeriod(mine.spending.thisMonth, partner.spending.thisMonth),
      last30: mergePeriod(mine.spending.last30, partner.spending.last30),
      last90: mergePeriod(mine.spending.last90, partner.spending.last90),
      year: mergePeriod(mine.spending.year, partner.spending.year),
    },
    goals: [
      ...mine.goals.map((g): OwnedGoal => ({ owner: 'me', ...g })),
      ...partner.goals.map((g): OwnedGoal => ({ owner: 'partner', ...g })),
    ],
  };
}

// ---------------------------------------------------------------------------
// Couple crypto: derive purpose-separated keys from the single pairing secret
// (S_pair) and seal/open the encrypted summary blobs. Built on the existing
// AES-256-GCM helpers in crypto.ts plus Node's HKDF — no new primitives, no
// hardcoded keys. S_pair is the only secret; it lives in the OS keychain.
// ---------------------------------------------------------------------------

export interface CoupleKeys {
  dataKey: Buffer;   // AES-256-GCM key for the summary blobs
  authKey: Buffer;   // client→relay request HMAC (optional MAC-gated writes)
  relayKey: Buffer;  // value the relay may verify without ever seeing the data key
}

// Distinct `info` strings give HKDF domain separation: one secret, three keys, no role overlap.
const KDF = { data: 'kesef/couple/data/v1', auth: 'kesef/couple/auth/v1', relay: 'kesef/couple/relay/v1' } as const;
const KDF_SALT = Buffer.alloc(0); // no salt (S_pair is already high-entropy); see crypto §4

function hkdf32(ikm: Buffer, info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', ikm, KDF_SALT, Buffer.from(info, 'utf8'), 32));
}

/** Derive the {data, auth, relay} key tree from the 32-byte pairing secret. */
export function deriveCoupleKeys(sPair: Buffer): CoupleKeys {
  return {
    dataKey: hkdf32(sPair, KDF.data),
    authKey: hkdf32(sPair, KDF.auth),
    relayKey: hkdf32(sPair, KDF.relay),
  };
}

export const COUPLE_BLOB_SCHEMA = 'kesef.couple.blob/v1';

/** Non-secret context bound into the blob's AAD so it can't be moved or replayed. */
export interface BlobContext { pairingId: string; slot: 'A' | 'B'; seq: number }

function blobAad(ctx: BlobContext): Buffer {
  return Buffer.from(`${COUPLE_BLOB_SCHEMA}|${ctx.pairingId}|${ctx.slot}|${ctx.seq}`, 'utf8');
}

/** Encrypt a summary for upload. A fresh nonce is used every call; context is authenticated via AAD. */
export function sealCoupleBlob(summary: CoupleSummary, dataKey: Buffer, ctx: BlobContext): EncryptedBlob {
  return encrypt(JSON.stringify(summary), dataKey, blobAad(ctx));
}

/** Decrypt + parse a summary. Throws if the key is wrong, the blob was tampered, or the context (pairingId/slot/seq) doesn't match. */
export function openCoupleBlob(blob: EncryptedBlob, dataKey: Buffer, ctx: BlobContext): CoupleSummary {
  return JSON.parse(decrypt(blob, dataKey, blobAad(ctx))) as CoupleSummary;
}

// ---------------------------------------------------------------------------
// Pairing token: the one-time QR/text payload that gives both devices the same
// high-entropy secret. The secret is transferred out-of-band (shown as a QR,
// scanned by the partner) — we never invent a key-exchange protocol.
// ---------------------------------------------------------------------------

export const PAIRING_PREFIX = 'kesef-pair:v1:';
export interface Pairing { pairingId: string; sPair: Buffer }

/** Generate a fresh pairing: a random 128-bit id and a random 256-bit secret. */
export function newPairing(): Pairing {
  return { pairingId: randomBytes(16).toString('hex'), sPair: randomBytes(32) };
}

/** Encode a pairing as the QR/text payload: `kesef-pair:v1:<pairingId>:<base64url S_pair>`. */
export function makePairingToken(p: Pairing): string {
  return `${PAIRING_PREFIX}${p.pairingId}:${p.sPair.toString('base64url')}`;
}

/** Decode a pairing token. Throws on a wrong-version or malformed token. */
export function parsePairingToken(token: string): Pairing {
  if (!token.startsWith(PAIRING_PREFIX)) throw new Error('not a kesef v1 pairing token');
  const rest = token.slice(PAIRING_PREFIX.length);
  const sep = rest.indexOf(':');
  if (sep < 0) throw new Error('malformed pairing token (missing secret)');
  const pairingId = rest.slice(0, sep);
  const sPair = Buffer.from(rest.slice(sep + 1), 'base64url');
  if (!pairingId || sPair.length !== 32) throw new Error('malformed pairing token');
  return { pairingId, sPair };
}
