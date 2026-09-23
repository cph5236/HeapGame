import { defineConfig } from 'vite';

// Serves the admin app (admin/index.html + admin/src) over http.
//
// Two jobs: give the page a real Origin the Worker's CORS allowlist can name
// (opened straight off disk it would send `Origin: null`, which stopped being
// accepted when ALLOWED_ORIGINS came off `*` — see server/wrangler.toml), and
// compile admin/src's TypeScript, which imports constants from ../shared so
// the admin can never drift from what the game and server actually use.
// Vite's default fs allow-list is the repo root, so ../shared is servable.
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
