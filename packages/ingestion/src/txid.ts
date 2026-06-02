import { createHash } from 'node:crypto';

export interface TxIdParts {
  accountNumber: string;
  date: string;            // ISO
  chargedAmount: number;
  description: string;
  identifier?: number | string | null;
}

/** Deterministic, collision-resistant id for a bank transaction (stable across re-syncs). */
export function txId(p: TxIdParts): string {
  const key = [p.accountNumber, p.date, p.chargedAmount, p.description, p.identifier ?? ''].join('|');
  return createHash('sha256').update(key).digest('hex').slice(0, 24);
}
