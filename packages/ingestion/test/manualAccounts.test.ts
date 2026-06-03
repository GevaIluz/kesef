import { describe, it, expect } from 'vitest';
import { manualAccountFor } from '../src/manualAccounts';

describe('manualAccountFor', () => {
  it('pension → retirement bucket (type pension)', () => {
    expect(manualAccountFor('pension')).toMatchObject({
      id: 'manual:pension', institution: 'manual', type: 'pension', displayName: 'Pension',
    });
  });
  it('gemel (provident fund) → pension type, distinct id', () => {
    expect(manualAccountFor('gemel')).toMatchObject({ id: 'manual:gemel', institution: 'manual', type: 'pension' });
  });
  it('keren (study fund) → investment type (semi-liquid)', () => {
    expect(manualAccountFor('keren')).toMatchObject({ id: 'manual:keren', institution: 'manual', type: 'investment' });
  });
  it('ibi → investment portfolio', () => {
    expect(manualAccountFor('ibi')).toMatchObject({ id: 'ibi:portfolio', institution: 'ibi', type: 'investment' });
  });
  it('savings → liquid bank type', () => {
    expect(manualAccountFor('savings')).toMatchObject({ id: 'manual:savings', type: 'bank' });
  });
  it('other derives a stable id from the given name and keeps it as the label', () => {
    expect(manualAccountFor('other', 'Leumi rent')).toMatchObject({
      id: 'manual:leumi rent', institution: 'manual', type: 'bank', displayName: 'Leumi rent',
    });
  });
  it('a custom name overrides the default label for a known kind', () => {
    expect(manualAccountFor('pension', 'Migdal pension').displayName).toBe('Migdal pension');
    expect(manualAccountFor('pension', 'Migdal pension').id).toBe('manual:pension'); // id stays canonical
  });
  it('blank/unknown name on other falls back to a safe id', () => {
    expect(manualAccountFor('other', '   ').id).toBe('manual:account');
  });
});
