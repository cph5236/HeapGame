import type { AdProvider } from './AdProvider';

/**
 * Whether this session may actually show an ad.
 *
 * `enabled` alone only says which provider is wired up; it says nothing about
 * consent. Callers that decide ad *eligibility* — offering the rewarded button,
 * spending a cadence slot — must consult both, or a consent-gated session shows
 * ad UI that can only ever resolve false. The provider is passed in rather than
 * read from the singleton so callers stay testable, as with AdCadence.
 */
export function adsAvailable(provider: AdProvider): boolean {
  return provider.enabled && provider.canRequestAds;
}
