export interface AdProvider {
  initialize(): Promise<void>;
  showInterstitial(): Promise<void>;
  showRewarded(): Promise<boolean>;
}
