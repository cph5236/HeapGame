/// <reference types="vitest" />
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import pkg from './package.json';

// Dev build id = git short hash + build time, e.g. "3f9a1c·14:32:05". Exposed as
// VITE_BUILD_ID and only displayed in dev builds (import.meta.env.DEV); release
// builds show the version alone. Regenerated each time this config is evaluated
// (i.e. on `vite build` and on dev-server start). Git hash is best-effort.
function devBuildId(): string {
  let hash = 'nogit';
  try {
    hash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
  } catch { /* not a git checkout — fall back to nogit */ }
  const t = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${hash}·${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`;
}
const buildId = devBuildId();

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
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
    'import.meta.env.VITE_BUILD_ID': JSON.stringify(buildId),
    // NOTE: do NOT add `import.meta.env.VITE_*` ad keys here. Vite resolves
    // VITE_-prefixed keys from process.env / .env at startup and that resolution
    // overrides any `define` for the same key, so a `|| fallback` here is dead
    // code. Ad-unit ID defaults live in .env; VITE_AD_PROVIDER is exported by
    // the build:android script (admob) and otherwise defaults to NullProvider.
  },
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', '**/android/**', '**/dist/**'],
    define: {
      'import.meta.env.VITE_APP_VERSION':          JSON.stringify(pkg.version),
      'import.meta.env.VITE_BUILD_ID':             JSON.stringify(buildId),
      'import.meta.env.VITE_AD_PROVIDER':          JSON.stringify('null'),
      'import.meta.env.VITE_ADMOB_INTERSTITIAL_ID': JSON.stringify('ca-app-pub-3940256099942544/1033173712'),
      'import.meta.env.VITE_ADMOB_REWARDED_ID':    JSON.stringify('ca-app-pub-3940256099942544/5224354917'),
    },
  },
});
