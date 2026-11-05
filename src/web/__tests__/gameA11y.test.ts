import { describe, it, expect, beforeAll } from 'vitest';
import { isGameKeyTarget, pauseActiveRun, shouldGameHandleKey, FocusRingTracker, FOCUS_RING_ATTR } from '../gameA11y';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Minimal document/window stand-ins: vitest runs in node.
const body = { tag: 'body' };
const html = { tag: 'html' };
const doc  = { body, documentElement: html };
beforeAll(() => {
  Object.defineProperty(global, 'document', { value: doc, configurable: true });
  Object.defineProperty(global, 'window', { value: global, configurable: true });
});

describe('isGameKeyTarget', () => {
  const canvas = { tag: 'canvas' } as unknown as Element;

  it('routes keys to the game when the canvas, body or nothing is focused', () => {
    expect(isGameKeyTarget(canvas, canvas)).toBe(true);
    expect(isGameKeyTarget(body as unknown as EventTarget, canvas)).toBe(true);
    expect(isGameKeyTarget(html as unknown as EventTarget, canvas)).toBe(true);
    expect(isGameKeyTarget(null, canvas)).toBe(true);
  });

  it('leaves keys alone when a page control is focused', () => {
    const link = { tag: 'a' } as unknown as EventTarget;
    const input = { tag: 'input' } as unknown as EventTarget;
    expect(isGameKeyTarget(link, canvas)).toBe(false);
    expect(isGameKeyTarget(input, canvas)).toBe(false);
  });
});

describe('pauseActiveRun', () => {
  it('opens the pause menu on the first running scene that has one', () => {
    let paused = 0;
    const game = {
      scene: { getScenes: () => [{ key: 'HUD' }, { openPauseMenu: () => { paused++; } }] },
    } as unknown as Parameters<typeof pauseActiveRun>[0];
    pauseActiveRun(game);
    expect(paused).toBe(1);
  });

  it('does nothing when no running scene can pause (menu, score screen)', () => {
    const game = { scene: { getScenes: () => [{ key: 'MenuScene' }] } } as unknown as Parameters<typeof pauseActiveRun>[0];
    expect(() => pauseActiveRun(game)).not.toThrow();
  });
});

// index.html is hand-written; these keep the IDs the code depends on honest.
describe('index.html accessibility hooks', () => {
  const page = readFileSync(resolve(__dirname, '../../../index.html'), 'utf8');

  it('has the description and live region the canvas wiring references', () => {
    expect(page).toContain('id="game-desc"');
    expect(page).toMatch(/id="a11y-live"[^>]*aria-live="polite"/);
  });

  it('has exactly one h1, landmarks and a skip link', () => {
    expect(page.match(/<h1[\s>]/g)?.length).toBe(1);
    for (const tag of ['<header', '<main', '<nav', '<footer']) expect(page).toContain(tag);
    expect(page).toContain('data-skip-to-game');
  });

  it('does not block pinch-zoom', () => {
    const viewport = page.match(/<meta name="viewport" content="([^"]*)"/)?.[1];
    expect(viewport).toBeTruthy();
    expect(viewport).not.toMatch(/user-scalable\s*=\s*no/);
    expect(viewport).not.toMatch(/maximum-scale/);
  });

  it('drives the canvas focus ring by data-focus-ring, never :focus-visible', () => {
    // A canvas :focus-visible rule turns on after any keypress on a clicked
    // canvas and stays — it outlined the whole menu for good. Check every
    // selector in the page's CSS, however it is grouped or qualified.
    const css = [...page.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
      .map(m => m[1].replace(/\/\*[\s\S]*?\*\//g, '')).join('\n');
    const selectors = [...css.matchAll(/([^{}]+)\{/g)]
      .flatMap(m => m[1].split(',').map(sel => sel.trim()));
    expect(selectors).toContain(`canvas[${FOCUS_RING_ATTR}]:focus`);
    expect(selectors.filter(sel => /canvas/.test(sel) && /:focus-visible/.test(sel))).toEqual([]);
  });

  it('links the accessibility statement', () => {
    expect(page).toContain('https://heapgame.com/accessibility');
  });
});

describe('shouldGameHandleKey', () => {
  const canvas = { tag: 'canvas' } as unknown as Element;
  const link  = { tagName: 'A' } as unknown as EventTarget;
  const input = { tagName: 'INPUT' } as unknown as EventTarget;

  it('lets Escape and P resume from a focused link', () => {
    expect(shouldGameHandleKey('Escape', link, canvas)).toBe(true);
    expect(shouldGameHandleKey('p', link, canvas)).toBe(true);
  });

  it('keeps other keys away from the game while a link is focused', () => {
    expect(shouldGameHandleKey(' ', link, canvas)).toBe(false);
    expect(shouldGameHandleKey('ArrowLeft', link, canvas)).toBe(false);
  });

  it('never steals P (or Escape) from a text field', () => {
    expect(shouldGameHandleKey('p', input, canvas)).toBe(false);
    expect(shouldGameHandleKey('Escape', input, canvas)).toBe(false);
  });
});

describe('FocusRingTracker', () => {
  it('starts off, and Tab turns it on', () => {
    const t = new FocusRingTracker();
    expect(t.navigating).toBe(false);
    expect(t.keyDown('Tab')).toBe(false);
    expect(t.navigating).toBe(true);
  });

  it('keeps the ring through modifiers (Shift+Tab, Ctrl, Alt, Meta, CapsLock)', () => {
    const t = new FocusRingTracker();
    t.keyDown('Tab');
    for (const k of ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']) {
      expect(t.keyDown(k)).toBe(false);
      expect(t.navigating).toBe(true);
    }
  });

  it('drops the ring on any game key', () => {
    for (const k of [' ', 'u', 'ArrowLeft', 'Escape', 'Enter', 'p']) {
      const t = new FocusRingTracker();
      t.keyDown('Tab');
      expect(t.keyDown(k)).toBe(true);
      expect(t.navigating).toBe(false);
    }
  });

  it('a hotkey after a click never turns the ring on (the original bug)', () => {
    const t = new FocusRingTracker();
    t.pointerDown();
    t.keyDown('u');
    expect(t.navigating).toBe(false);
  });

  it('a pause resumed with Esc/P refocuses without a ring', () => {
    const t = new FocusRingTracker();
    t.keyDown('Tab');
    t.keyDown('Escape'); // pause
    t.keyDown('p');      // resume → refocusGame() → focus handler reads navigating
    expect(t.navigating).toBe(false);
  });

  it('a pointer press ends keyboard navigation; the skip link starts it', () => {
    const t = new FocusRingTracker();
    t.keyDown('Tab');
    t.pointerDown();
    expect(t.navigating).toBe(false);
    t.keyboardFocus();
    expect(t.navigating).toBe(true);
  });
});
