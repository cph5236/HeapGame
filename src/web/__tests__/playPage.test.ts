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

// The ref-forwarding script is the one piece of behavior on this page, so it is
// run rather than string-matched: the script is lifted out of the HTML and
// executed against stub globals, which means these assert what a visitor
// actually gets rather than what the source happens to look like.
describe('/play forwards the referral marker', () => {
  const script = page.match(/\(function \(\) \{[\s\S]*?\}\)\(\);/)?.[0];

  function hrefAfterVisiting(search: string): string {
    const door = { href: 'https://heapgame.com/' };
    const fn = new Function('window', 'document', 'URLSearchParams', script!);
    fn(
      { location: { search } },
      { getElementById: (id: string) => (id === 'door-web' ? door : null) },
      URLSearchParams,
    );
    return door.href;
  }

  it('is present at all', () => {
    expect(script).toBeTruthy();
    expect(page).toContain('id="door-web"');
  });

  it('carries a shared link\'s marker through to the game', () => {
    // SHARE_URL points at /play?ref=run, and this door is the browser half of
    // the chooser. Without this the marker dies on the page it lands on.
    expect(hrefAfterVisiting('?ref=run')).toBe('https://heapgame.com/?ref=run');
  });

  it('leaves the door alone for an ordinary visit', () => {
    expect(hrefAfterVisiting('')).toBe('https://heapgame.com/');
  });

  it('drops a marker the reader would reject anyway', () => {
    // Same charset and length contract as the counter that will read it, so
    // junk never reaches the game in the first place.
    expect(hrefAfterVisiting('?ref=' + 'a'.repeat(33))).toBe('https://heapgame.com/');
    expect(hrefAfterVisiting('?ref=bad%20ref')).toBe('https://heapgame.com/');
    expect(hrefAfterVisiting('?ref=<script>')).toBe('https://heapgame.com/');
  });

  it('normalizes case, the way the reader will', () => {
    expect(hrefAfterVisiting('?ref=RUN')).toBe('https://heapgame.com/?ref=run');
  });

  it('never throws, whatever the query string is', () => {
    // A broken marker must not take the door down with it.
    expect(() => hrefAfterVisiting('?%%%')).not.toThrow();
  });
});
