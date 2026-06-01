import { describe, it, expect } from 'vitest';
import { isExpense, type Transaction } from '../src/index';

const tx: Transaction = {
  id: 't1', accountId: 'a1', date: '2026-05-01',
  amount: -42.5, description: 'Coffee', shareable: false,
};

describe('domain model', () => {
  it('treats negative amounts as expenses', () => {
    expect(isExpense(tx)).toBe(true);
    expect(isExpense({ ...tx, amount: 100 })).toBe(false);
  });
});
