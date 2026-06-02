import { describe, it, expect } from 'vitest';
import { patchForManualLogin } from '../src/interactive';

describe('patchForManualLogin', () => {
  it('clears fields and replaces auto-submit with a no-op, preserving other login options', () => {
    const fake = {
      getLoginOptions: (_c: unknown): Record<string, unknown> => ({
        loginUrl: 'https://bank/login',
        fields: [{ selector: '#u', value: 'USER' }, { selector: '#p', value: 'PASS' }],
        submitButtonSelector: '#login-btn',
        possibleResults: { SUCCESS: [/dashboard/] },
        preAction: () => Promise.resolve(),
      }),
    };
    patchForManualLogin(fake);
    const opts = fake.getLoginOptions({ username: 'x', password: 'y' });

    expect(opts['fields']).toEqual([]);                          // nothing is auto-typed
    expect(typeof opts['submitButtonSelector']).toBe('function'); // nothing is auto-clicked
    expect(opts['loginUrl']).toBe('https://bank/login');          // preserved
    expect(opts['possibleResults']).toEqual({ SUCCESS: [/dashboard/] }); // preserved (success detection)
    expect(typeof opts['preAction']).toBe('function');            // preserved
  });

  it('the replacement submit resolves without throwing', async () => {
    const fake = {
      getLoginOptions: (_c: unknown): Record<string, unknown> => ({ fields: [{ selector: 's', value: 'v' }], submitButtonSelector: '#b' }),
    };
    patchForManualLogin(fake);
    const submit = fake.getLoginOptions({})['submitButtonSelector'] as () => Promise<void>;
    await expect(submit()).resolves.toBeUndefined();
  });
});
