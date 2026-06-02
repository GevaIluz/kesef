import { describe, it, expect } from 'vitest';
import { categorize } from '../src/categorize';

describe('categorize', () => {
  it('matches Hebrew + English merchants to categories', () => {
    expect(categorize('שופרסל דיל')).toBe('groceries');
    expect(categorize('RAMI LEVY')).toBe('groceries');
    expect(categorize('פז יבcorp')).toBe('transport');
    expect(categorize('NETFLIX.COM')).toBe('entertainment');
    expect(categorize('חברת חשמל לישראל')).toBe('utilities');
    expect(categorize('סופר פארם')).toBe('health');
    expect(categorize('משכורת')).toBe('income');
    expect(categorize('מ.תחבורה - רב-פס')).toBe('transport');
  });
  it('is case-insensitive and substring-based', () => {
    expect(categorize('payment to NeTfLiX')).toBe('entertainment');
  });
  it('falls back to other for unknown merchants', () => {
    expect(categorize('סתם משהו לא מוכר')).toBe('other');
  });
  it('applies user overrides with precedence', () => {
    expect(categorize('CORNER SHOP', { 'corner shop': 'groceries' })).toBe('groceries');
    expect(categorize('שופרסל', { 'שופרסל': 'shopping' })).toBe('shopping');
  });
});
