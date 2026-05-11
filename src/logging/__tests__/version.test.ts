import { describe, it, expect } from 'vitest';

describe('VITE_APP_VERSION', () => {
  it('is a non-empty semver-like string', () => {
    const v = import.meta.env.VITE_APP_VERSION;
    expect(typeof v).toBe('string');
    expect(v).toMatch(/^\d+\.\d+\.\d+/);
  });
});
