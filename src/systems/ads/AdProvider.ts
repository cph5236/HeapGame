export interface AdProvider {
  readonly enabled: boolean;
  initialize(): Promise<void>;
  showInterstitial(): Promise<void>;
  showRewarded(): Promise<boolean>;

  /** True once consent has settled and Google permits ad requests. Ads are
   *  gated on this, so it stays false whenever consent could not be gathered —
   *  a declined consent still allows (non-personalized) ads and reads true. */
  readonly canRequestAds: boolean;

  /** True when Google requires us to surface a privacy options entry point,
   *  i.e. the player is in the EEA, UK or Switzerland. */
  readonly privacyOptionsRequired: boolean;

  /** Reopens Google's privacy options form so the player can change consent. */
  showPrivacyOptions(): Promise<void>;
}
