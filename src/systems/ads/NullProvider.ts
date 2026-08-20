import type { AdProvider } from './AdProvider';

export class NullProvider implements AdProvider {
  readonly enabled = false;
  /** Web and itch builds ship no ad code, so there is nothing to consent to. */
  readonly canRequestAds = false;
  readonly privacyOptionsRequired = false;
  async initialize(): Promise<void> {}
  async showInterstitial(): Promise<void> {}
  async showRewarded(): Promise<boolean> { return false; }
  async showPrivacyOptions(): Promise<void> {}
}
