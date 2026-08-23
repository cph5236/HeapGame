import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

const { adClient } = vi.hoisted(() => ({
  adClient: { initialize: vi.fn() },
}));
vi.mock('../AdClient', () => ({ AdClient: adClient }));

import { beginAdConsent, consentSettled, resetConsentForTests } from '../consentGate';
import { CONSENT_TIMEOUT_MS } from '../../../constants';

beforeEach(() => {
  vi.clearAllMocks();
  resetConsentForTests();
  adClient.initialize.mockResolvedValue(undefined);
});

afterEach(() => { vi.useRealTimers(); });

describe('consentGate', () => {
  it('settles once the ad provider finishes gathering consent', async () => {
    beginAdConsent();
    await expect(consentSettled()).resolves.toBeUndefined();
    expect(adClient.initialize).toHaveBeenCalled();
  });

  it('settles at the ceiling when consent never resolves', async () => {
    vi.useFakeTimers();
    adClient.initialize.mockReturnValue(new Promise(() => { /* never settles */ }));

    beginAdConsent();
    const settled = consentSettled();
    vi.advanceTimersByTime(CONSENT_TIMEOUT_MS);

    await expect(settled).resolves.toBeUndefined();
  });

  it('settles rather than rejecting when consent throws', async () => {
    adClient.initialize.mockRejectedValue(new Error('native bridge missing'));

    beginAdConsent();

    await expect(consentSettled()).resolves.toBeUndefined();
  });

  it('resolves immediately when consent was never started', async () => {
    await expect(consentSettled()).resolves.toBeUndefined();
    expect(adClient.initialize).not.toHaveBeenCalled();
  });

  it('gathers consent only once across repeated calls', () => {
    beginAdConsent();
    beginAdConsent();

    expect(adClient.initialize).toHaveBeenCalledTimes(1);
  });
});
