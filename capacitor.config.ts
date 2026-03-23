import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.heapgame.app',
  appName: 'Heap',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
