import { describe, it, expect } from 'vitest';
import { parseShekel, pickTotal, type TotalCandidate } from '../src/ibi';

describe('parseShekel', () => {
  it('parses Israeli-formatted currency (comma thousands, dot decimal)', () => {
    expect(parseShekel('₪1,234,567.89')).toBeCloseTo(1234567.89);
    expect(parseShekel('1,234,567')).toBe(1234567);
    expect(parseShekel('12,345.6 ₪')).toBeCloseTo(12345.6);
    expect(parseShekel('ש"ח 5,000')).toBe(5000);
    expect(parseShekel('250000')).toBe(250000);
  });
  it('keeps a negative sign (e.g. owing / loss), incl. unicode minus', () => {
    expect(parseShekel('-1,200')).toBe(-1200);
    expect(parseShekel('−1,200')).toBe(-1200); // unicode minus (U+2212) normalized to ASCII
  });
  it('returns null for non-numeric text', () => {
    expect(parseShekel('שלום')).toBe(null);
    expect(parseShekel('')).toBe(null);
    expect(parseShekel('₪')).toBe(null);
  });
});

describe('pickTotal', () => {
  const C = (value: number, context: string): TotalCandidate => ({ value, text: String(value), context });
  it('prefers a candidate whose context names the portfolio total', () => {
    const cands = [C(5000, 'מזומן'), C(245000, 'ניירות ערך'), C(250000, 'שווי תיק כולל')];
    expect(pickTotal(cands)!.value).toBe(250000);
  });
  it('falls back to the largest positive value when no label matches', () => {
    const cands = [C(5000, 'row a'), C(245000, 'row b'), C(12, 'row c')];
    expect(pickTotal(cands)!.value).toBe(245000);
  });
  it('ignores zero/negative noise', () => {
    const cands = [C(0, 'x'), C(-30, 'y')];
    expect(pickTotal(cands)).toBe(null);
  });
});
