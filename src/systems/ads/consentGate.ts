// Consent has to be gathered before the ads SDK issues any request, so the
// loading screen waits on it the same way it waits on GPGS sign-in. The wait
// is bounded: a hung consent fetch must not strand the player on the loading
// screen. Timing out is not fatal — consent carries on resolving in the
// background and AdMobProvider flips canRequestAds when it lands, so the only
// cost is that ads stay off until then.
//
// Single-shot by design: there is no retry path. A transient failure during the
// boot window costs that session its ads and its Settings privacy row, and the
// next launch starts clean. Adding a retry was considered and declined - the
// fail-closed default is the safe direction, and a restart already recovers it.
import { AdClient } from './AdClient';
import { CONSENT_TIMEOUT_MS } from '../../constants';

let settlePromise: Promise<void> | null = null;

/** Kick off consent gathering. Idempotent — repeat calls join the first. */
export function beginAdConsent(): void {
  if (settlePromise) return;

  settlePromise = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, CONSENT_TIMEOUT_MS);
    const done = () => { clearTimeout(timer); resolve(); };

    AdClient.initialize().then(done, done);
  });
}

/** Resolves when consent has settled or the ceiling expired. Never rejects. */
export function consentSettled(): Promise<void> {
  return settlePromise ?? Promise.resolve();
}

export function resetConsentForTests(): void { settlePromise = null; }
