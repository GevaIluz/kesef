import type { Account } from '@kesef/core';

/** Kinds of money you can add manually (no scraper exists for these in Israel). */
export type BalanceKind = 'pension' | 'gemel' | 'keren' | 'ibi' | 'savings' | 'other';

export interface ManualAccountSpec {
  id: string;
  institution: Account['institution'];
  type: Account['type'];
  displayName: string;
}

/**
 * Map a balance "kind" (+ optional custom name) to the Account it should create/update.
 * Shared by the CLI (`add-balance`) and the app server (`POST /api/balance`) so they agree.
 * Canonical kinds keep a stable id (re-entering updates the same account); 'other' derives
 * its id from the name so you can track several custom accounts (Leumi, cash, a loan…).
 */
export function manualAccountFor(kind: BalanceKind, name?: string): ManualAccountSpec {
  const n = (name ?? '').trim();
  switch (kind) {
    case 'pension': return { id: 'manual:pension', institution: 'manual', type: 'pension',    displayName: n || 'Pension' };
    case 'gemel':   return { id: 'manual:gemel',   institution: 'manual', type: 'pension',    displayName: n || 'Provident fund' };
    case 'keren':   return { id: 'manual:keren',   institution: 'manual', type: 'investment', displayName: n || 'Study fund' };
    case 'ibi':     return { id: 'ibi:portfolio',  institution: 'ibi',    type: 'investment', displayName: n || 'IBI portfolio' };
    case 'savings': return { id: 'manual:savings', institution: 'manual', type: 'bank',       displayName: n || 'Savings' };
    case 'other':
    default:        return { id: `manual:${(n || 'account').toLowerCase()}`, institution: 'manual', type: 'bank', displayName: n || 'Account' };
  }
}
