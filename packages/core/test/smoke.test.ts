import { describe, it, expect } from 'vitest';
import { VERSION } from '../src/index';

describe('core package', () => {
  it('exposes a version string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
