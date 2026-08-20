import { describe, it, expect } from 'vitest';
import { adsAvailable } from '../adsAvailable';
import type { AdProvider } from '../AdProvider';

const provider = (enabled: boolean, canRequestAds: boolean): AdProvider => ({
  enabled, canRequestAds,
  privacyOptionsRequired: false,
  initialize:         async () => {},
  showInterstitial:   async () => {},
  showRewarded:       async () => false,
  showPrivacyOptions: async () => {},
});

describe('adsAvailable', () => {
  it('is true once ads are enabled and consent permits requests', () => {
    expect(adsAvailable(provider(true, true))).toBe(true);
  });

  it('is false while consent is still unresolved', () => {
    // Otherwise the caller burns a cadence slot and offers a reward button
    // that can only ever resolve false.
    expect(adsAvailable(provider(true, false))).toBe(false);
  });

  it('is false when the build ships no ads at all', () => {
    expect(adsAvailable(provider(false, false))).toBe(false);
  });
});
