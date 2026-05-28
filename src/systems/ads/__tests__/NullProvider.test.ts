import { describe, it, expect } from 'vitest';
import { NullProvider } from '../NullProvider';

describe('NullProvider', () => {
  it('initialize resolves without throwing', async () => {
    const p = new NullProvider();
    await expect(p.initialize()).resolves.toBeUndefined();
  });

  it('showInterstitial resolves without throwing', async () => {
    const p = new NullProvider();
    await expect(p.showInterstitial()).resolves.toBeUndefined();
  });

  it('showRewarded resolves false', async () => {
    const p = new NullProvider();
    await expect(p.showRewarded()).resolves.toBe(false);
  });
});
