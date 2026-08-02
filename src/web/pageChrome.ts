/**
 * Browser page chrome: the content rails either side of the portrait game
 * column, and the install prompt that appears on returning to the main menu.
 *
 * None of this is part of the Phaser scene graph. The game is a fixed-width
 * portrait column (see index.html), which on a desktop viewport leaves several
 * hundred pixels of dead space on each side; this fills it without touching the
 * game's layout math or the already-cramped score screen.
 *
 * It is inert in two places on purpose:
 *   - the Capacitor Android shell, where the player already has the app
 *   - inside an iframe (itch.io frames the build), where the host page owns the
 *     surrounding chrome
 *
 * The markup lives statically in index.html so it paints immediately and is
 * real HTML for crawlers; this module only handles visibility and the prompt.
 */

import { Capacitor } from '@capacitor/core';
import { PLAY_STORE_URL } from '../systems/UpdateGate';
import { HEAP_RUN_FINISHED_EVENT } from './hostEvents';
import { shouldShowInstallPrompt, shouldShowRails } from './installPromptLogic';

const OPT_OUT_KEY = 'heap_install_prompt_opt_out';

function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

function inIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // Cross-origin frame access throws — which itself means we are framed.
    return true;
  }
}

function readOptOut(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === '1';
  } catch {
    return false;
  }
}

function writeOptOut(): void {
  try {
    localStorage.setItem(OPT_OUT_KEY, '1');
  } catch {
    /* private browsing — the prompt just reappears next load */
  }
}

/** Width of one dead-space rail, from the same math index.html uses for #game. */
function measureRailWidth(): number {
  const gameEl = document.getElementById('game');
  const gameW = gameEl?.getBoundingClientRect().width ?? window.innerWidth;
  return Math.floor((window.innerWidth - gameW) / 2);
}

export function initPageChrome(): void {
  const native = isNative();
  const framed = inIframe();

  const root = document.documentElement;
  const prompt = document.getElementById('install-prompt');
  const dismissBtn = document.getElementById('install-prompt-dismiss');
  const optOutBox = document.getElementById('install-prompt-optout') as HTMLInputElement | null;

  // Point every Play link at the shared constant so the app id lives in one place.
  document.querySelectorAll<HTMLAnchorElement>('[data-play-link]').forEach((a) => {
    a.href = PLAY_STORE_URL;
  });

  const syncRails = (): void => {
    const show = shouldShowRails({
      railWidthPx: measureRailWidth(),
      isNative: native,
      inIframe: framed,
    });
    root.dataset.rails = show ? 'on' : 'off';
  };

  syncRails();
  window.addEventListener('resize', syncRails);
  window.addEventListener('orientationchange', syncRails);

  if (native || framed) return;

  let runsFinished = 0;
  let shownThisSession = false;

  const hidePrompt = (persist: boolean): void => {
    prompt?.setAttribute('hidden', '');
    if (persist) writeOptOut();
  };

  dismissBtn?.addEventListener('click', () => {
    hidePrompt(optOutBox?.checked === true);
  });

  window.addEventListener(HEAP_RUN_FINISHED_EVENT, () => {
    runsFinished += 1;
    const show = shouldShowInstallPrompt({
      runsFinished,
      optedOut: readOptOut(),
      shownThisSession,
      isNative: native,
      inIframe: framed,
    });
    if (!show) return;
    shownThisSession = true;
    prompt?.removeAttribute('hidden');
  });
}
