/**
 * Resets the load-test heap fixtures to an empty live zone so runs are
 * repeatable. Identities in fixtures.json are deliberately preserved —
 * reusing them across runs is what keeps score-submit KV cost low.
 *
 * Usage:
 *   BASE_URL=... ADMIN_SECRET=... npm run loadtest:reset
 */

/// <reference types="node" />

import { readFileSync } from 'node:fs';

const BASE_URL     = process.env.BASE_URL     ?? '';
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? '';

if (!BASE_URL)     throw new Error('BASE_URL is required');
if (!ADMIN_SECRET) throw new Error('ADMIN_SECRET is required');

/**
 * Same production safety gate as seed-staging.ts (kept as a local copy —
 * this task doesn't own a shared loadtest lib module). An allow-list rather
 * than a deny-list on the production hostname, since a deny-list stops
 * protecting the day the production URL's shape changes. Resetting a live
 * production heap would be just as destructive as seeding one, so this
 * script gets the same gate even though only the seed script was mandated.
 */
function looksLikeStaging(url: string): boolean {
  // Match the HOSTNAME only. Testing the whole URL string would let
  // https://heap-server-prod.example.com/?note=staging through the gate.
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false; // unparseable URL is not something we should write to
  }
  return /\bstaging\b/i.test(host) || host === 'localhost' || host === '127.0.0.1';
}

if (!looksLikeStaging(BASE_URL)) {
  throw new Error(
    `Refusing to reset a URL that doesn't look like the staging Worker or a local dev server: "${BASE_URL}". ` +
    'Expected the hostname to contain "staging" (e.g. https://heap-server-staging.<sub>.workers.dev) or a localhost address.',
  );
}

interface Fixtures { smallHeapId: string; largeHeapId: string }

async function main(): Promise<void> {
  const raw = readFileSync(new URL('../fixtures.json', import.meta.url), 'utf8');
  const { smallHeapId, largeHeapId } = JSON.parse(raw) as Fixtures;

  for (const id of [smallHeapId, largeHeapId]) {
    const res = await fetch(`${BASE_URL}/heaps/${id}/reset`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_SECRET },
    });
    if (!res.ok) throw new Error(`reset ${id} failed: ${res.status} ${await res.text()}`);
    console.log(`reset ${id}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
