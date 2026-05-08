import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hanlinsoftware.heapgame.app',
  appName: 'Heap',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
