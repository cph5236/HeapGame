import type { AdProvider } from './AdProvider';

export class NullProvider implements AdProvider {
  async initialize(): Promise<void> {}
  async showInterstitial(): Promise<void> {}
  async showRewarded(): Promise<boolean> { return false; }
}
