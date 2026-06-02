import { describe, it, expect } from 'vitest';
import { mapCardCategory } from '../src/cardCategory';
import { assignCategory } from '../src/categorize';

describe('mapCardCategory', () => {
  it('maps known Cal categories (Hebrew) to our buckets', () => {
    expect(mapCardCategory('מסעדות ובתי קפה')).toBe('dining');
    expect(mapCardCategory('סופרמרקטים')).toBe('groceries');
    expect(mapCardCategory('דלק')).toBe('transport');
  });
  it('returns undefined for unknown card categories', () => {
    expect(mapCardCategory('משהו אחר')).toBeUndefined();
    expect(mapCardCategory(undefined)).toBeUndefined();
  });
});

describe('assignCategory precedence', () => {
  it('prefers a mappable card category over description rules', () => {
    expect(assignCategory({ description: 'ל.ל אחזקות בע״מ', rawCategory: 'מסעדות ובתי קפה' })).toBe('dining');
  });
  it('falls back to description rules when card category is missing/unmappable', () => {
    expect(assignCategory({ description: 'שופרסל', rawCategory: undefined })).toBe('groceries');
    expect(assignCategory({ description: 'שופרסל', rawCategory: 'קטגוריה לא ידועה' })).toBe('groceries');
  });
  it('honours user overrides above everything', () => {
    expect(assignCategory({ description: 'ל.ל אחזקות', rawCategory: 'מסעדות ובתי קפה' }, { 'ל.ל אחזקות': 'other' })).toBe('other');
  });
});
