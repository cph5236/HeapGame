import { defineConfig } from 'vite';

// Serves admin/index.html over http so its API calls carry a real Origin.
//
// The page has no build step — it is one standalone file with an inline script
// and Tailwind from a CDN — so this config exists purely to give it an origin
// the Worker's CORS allowlist can name. Opened straight off disk the page sends
// `Origin: null`, which stopped being accepted when ALLOWED_ORIGINS came off
// `*` (see server/wrangler.toml).
//
// Deliberately separate from the root vite.config.ts rather than reusing it:
// that config carries the game's plugins and, more importantly, shares a
// dependency-optimizer cache. Running it a second time from a different root
// invalidates the cache out from under an already-running `npm run dev`.
export default defineConfig({
  root: __dirname,
  cacheDir: `${__dirname}/.vite`,
  server: {
    // strictPort so a busy port fails loudly. Silently landing on 3002 would
    // surface as an unexplained CORS error, since only 3001 is allowlisted.
    port: 3001,
    strictPort: true,
    open: true,
  },
});
