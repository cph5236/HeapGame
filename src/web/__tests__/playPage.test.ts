// The /play landing page is a hand-written static file at public/play.html, deliberately
// outside the Vite/TS build: it is the target of the single link we hand to
// social posts, so it has to paint before the game bundle ever could. That means
// nothing type-checks it and nothing keeps its hardcoded URLs honest — hence
// these tests. It lives at public/play.html rather than public/play/index.html
// because Cloudflare Pages then serves the advertised URL (/play) with a 200
// instead of a 308 to /play/.
//
// ANDROID_APP_ID is read out of UpdateGate.ts as *text* rather than imported:
// that module pulls in @capacitor/core, which has no business loading in a node
// test just to read one string.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '../../..');
const page = readFileSync(resolve(repoRoot, 'public/play.html'), 'utf8');
const updateGate = readFileSync(resolve(repoRoot, 'src/systems/UpdateGate.ts'), 'utf8');

const appId = updateGate.match(/ANDROID_APP_ID = '([^']+)'/)?.[1];

describe('/play landing page', () => {
  it('sends the store button to the same listing the game does', () => {
    expect(appId).toBeTruthy();
    expect(page).toContain(`https://play.google.com/store/apps/details?id=${appId}`);
  });

  it('sends the browser button to the game', () => {
    expect(page).toContain('https://heapgame.com/');
  });

  it('loads no script or stylesheet bundle', () => {
    // Inline <script> for platform detection is fine; a fetched one is not.
    expect(page).not.toMatch(/<script[^>]+\ssrc=/i);
    expect(page).not.toMatch(/<link[^>]+rel=["']stylesheet["']/i);
  });

  it('stays small enough to paint on a phone connection', () => {
    // ~7KB of that is the inlined Play badge. The ceiling exists so nobody
    // quietly drops a screenshot in and turns the chooser into a download.
    expect(Buffer.byteLength(page)).toBeLessThan(60 * 1024);
  });
});
