// Thin launcher: `node --env-file` parses .env properly (tolerating quotes,
// comments and spaces around `=`, which plain `sh` sourcing does not), then
// hands the loaded environment to k6. k6 exposes the process environment via
// __ENV, so BASE_URL / LOADTEST_SECRET / etc. arrive without needing -e flags.
//
// Also writes every run's summary to loadtest/results/ so results are kept
// rather than scrolling out of the terminal — runs are expensive (a full one
// spends ~330 KV deletes from an account-wide daily bucket), so losing the
// numbers means paying again to get them back.
//
// Usage (see package.json):
//   node --env-file-if-exists=.env loadtest/scripts/run-k6.mjs [k6 flags] <script>

import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const loadtestDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const resultsDir = join(loadtestDir, 'results');
mkdirSync(resultsDir, { recursive: true });

const args = process.argv.slice(2);

// Tag the filename with the fixture under test, since the small/large
// comparison is the whole point of having two of them and otherwise the runs
// are indistinguishable on disk.
const fixtureFlag = args.find((a) => a.startsWith('PLACE_FIXTURE='))
  ?? (process.env.PLACE_FIXTURE ? `PLACE_FIXTURE=${process.env.PLACE_FIXTURE}` : '');
const fixture = fixtureFlag.split('=')[1] || 'small';
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const summaryPath = join(resultsDir, `${stamp}-${fixture}.json`);

// Only add --summary-export if the caller didn't specify their own.
const hasSummaryFlag = args.some((a) => a.startsWith('--summary-export'));
const k6Args = hasSummaryFlag ? args : [`--summary-export=${summaryPath}`, ...args];

const result = spawnSync('k6', ['run', ...k6Args], { stdio: 'inherit' });

if (result.error && result.error.code === 'ENOENT') {
  console.error(
    'k6 not found on PATH. Install it from https://grafana.com/docs/k6/latest/set-up/install-k6/ ' +
    'or drop the static binary somewhere on your PATH.',
  );
  process.exit(127);
}

if (!hasSummaryFlag) {
  console.log(`\nsummary written to ${summaryPath.replace(`${loadtestDir}/`, 'loadtest/')}`);
}

// k6 exits non-zero when a threshold is crossed. That is a real result, not a
// harness failure, so the exit code is passed through unchanged.
process.exit(result.status ?? 1);
