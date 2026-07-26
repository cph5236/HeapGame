// Thin launcher: `node --env-file` parses .env properly (tolerating quotes,
// comments and spaces around `=`, which plain `sh` sourcing does not), then
// hands the loaded environment to k6. k6 exposes the process environment via
// __ENV, so BASE_URL / LOADTEST_SECRET / etc. arrive without needing -e flags.
//
// Usage (see package.json):
//   node --env-file-if-exists=.env loadtest/scripts/run-k6.mjs [k6 flags] <script>

import { spawnSync } from 'node:child_process';

const result = spawnSync('k6', ['run', ...process.argv.slice(2)], { stdio: 'inherit' });

if (result.error && result.error.code === 'ENOENT') {
  console.error(
    'k6 not found on PATH. Install it from https://grafana.com/docs/k6/latest/set-up/install-k6/ ' +
    'or drop the static binary somewhere on your PATH.',
  );
  process.exit(127);
}

process.exit(result.status ?? 1);
