import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryVault, type SecretVault } from '../src/index';

describe('SecretVault (in-memory)', () => {
  let vault: SecretVault;
  beforeEach(() => { vault = new InMemoryVault(); });

  it('returns null for a missing secret', async () => {
    expect(await vault.get('beinleumi:guy')).toBeNull();
  });

  it('stores and retrieves a secret', async () => {
    await vault.set('beinleumi:guy', 's3cret');
    expect(await vault.get('beinleumi:guy')).toBe('s3cret');
  });

  it('overwrites an existing secret', async () => {
    await vault.set('k', 'a');
    await vault.set('k', 'b');
    expect(await vault.get('k')).toBe('b');
  });

  it('deletes a secret', async () => {
    await vault.set('k', 'a');
    await vault.delete('k');
    expect(await vault.get('k')).toBeNull();
  });
});
