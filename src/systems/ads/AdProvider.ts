export interface AdProvider {
  readonly enabled: boolean;
  initialize(): Promise<void>;
  showInterstitial(): Promise<void>;
  showRewarded(): Promise<boolean>;
}
