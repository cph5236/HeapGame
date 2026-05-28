/// <reference types="vitest" />
import { defineConfig } from 'vite';
import pkg from './package.json';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ['phaser'],
        },
      },
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  define: {
    'import.meta.env.VITE_APP_VERSION':          JSON.stringify(pkg.version),
    'import.meta.env.VITE_AD_PROVIDER':          JSON.stringify(process.env.VITE_AD_PROVIDER || 'null'),
    'import.meta.env.VITE_ADMOB_INTERSTITIAL_ID': JSON.stringify(process.env.VITE_ADMOB_INTERSTITIAL_ID || 'ca-app-pub-3940256099942544/1033173712'),
    'import.meta.env.VITE_ADMOB_REWARDED_ID':    JSON.stringify(process.env.VITE_ADMOB_REWARDED_ID || 'ca-app-pub-3940256099942544/5224354917'),
  },
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', '**/android/**', '**/dist/**'],
    define: {
      'import.meta.env.VITE_APP_VERSION':          JSON.stringify(pkg.version),
      'import.meta.env.VITE_AD_PROVIDER':          JSON.stringify('null'),
      'import.meta.env.VITE_ADMOB_INTERSTITIAL_ID': JSON.stringify('ca-app-pub-3940256099942544/1033173712'),
      'import.meta.env.VITE_ADMOB_REWARDED_ID':    JSON.stringify('ca-app-pub-3940256099942544/5224354917'),
    },
  },
});
