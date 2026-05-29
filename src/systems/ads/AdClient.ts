import type { AdProvider } from './AdProvider';
import { NullProvider } from './NullProvider';
import { AdMobProvider } from './AdMobProvider';

const _provider: AdProvider =
  (import.meta.env.VITE_AD_PROVIDER as string) === 'admob'
    ? new AdMobProvider()
    : new NullProvider();

export const AdClient: AdProvider = _provider;
export const AD_PROVIDER_NAME: string = (import.meta.env.VITE_AD_PROVIDER as string) === 'admob' ? 'admob' : 'null';
