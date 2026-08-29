// src/systems/shareRun.ts
//
// The score screen's share loop: turn a finished run into a message a player
// can post somewhere, with a link back to the /play chooser page.
//
// Split into a pure message builder (unit-tested here) and one impure
// `shareRun` that talks to the platform, because the copy is the part worth
// iterating on and the platform part is untestable without a browser.

import type { ShareOutcome } from '../../shared/logging/events';

/** Where a shared link lands.
 *
 *  `/play` rather than `/` on purpose: it is the chooser page (browser vs.
 *  Android app) and already carries its own OG/Twitter cards, so a pasted link
 *  previews correctly wherever it is posted. The `ref` marks the visit as
 *  share-driven — it is a plain query param on a static page, so nothing has to
 *  read it for Cloudflare Web Analytics to break traffic down by it. */
export const SHARE_URL = 'https://heapgame.com/play?ref=run';

/** One line of pitch under the brag, for the reader who has never heard of the
 *  game. The brag alone means nothing to a stranger scrolling past. */
const PITCH = 'Heap is a free climbing game on trash piles that every player is building.';

/** Shown when a heap somehow arrives without a name (DEFAULT_HEAP_PARAMS is
 *  "Unnamed Heap", but a server row could still be blank). */
const GENERIC_HEAP = 'the heap';

export interface ShareRunInput {
  score: number;
  heapName: string;
  isInfinite: boolean;
  isNewHighScore: boolean;
  /** The run reached the summit and raised the heap for everyone. */
  isPeak: boolean;
}

export interface ShareMessage {
  title: string;
  text: string;
  url: string;
}

/** Re-exported so callers get the message builder and the outcome type from one
 *  import. Defined in shared/ because the analytics event carries it:
 *    'shared'      handed off to the OS share sheet
 *    'copied'      no share sheet — the message went to the clipboard instead
 *    'dismissed'   the player opened the share sheet and backed out
 *    'unavailable' neither path was usable; the caller should say so */
export type { ShareOutcome } from '../../shared/logging/events';

/** Builds the brag + pitch for a finished run.
 *
 *  Ordered by how interesting the outcome is to someone who does not play:
 *  topping out (which visibly changes the shared heap) beats a personal best,
 *  which beats a bare number. */
export function buildShareMessage(input: ShareRunInput): ShareMessage {
  const score = input.score.toLocaleString('en-US');
  const heap  = input.heapName.trim() || GENERIC_HEAP;

  let brag: string;
  if (input.isInfinite) {
    // The infinite heap has no summit and its name ("Infinite") reads as a mode,
    // not a place, so it is described rather than named.
    brag = `${score} points up the endless heap.`;
  } else if (input.isPeak) {
    brag = `I topped out ${heap} at ${score} points — my junk is on the pile now, so go climb over it.`;
  } else if (input.isNewHighScore) {
    brag = `New personal best on ${heap}: ${score} points.`;
  } else {
    brag = `${score} points on ${heap}.`;
  }

  return { title: 'Heap', text: `${brag}\n${PITCH}`, url: SHARE_URL };
}

/** Flattens a message for the clipboard, where there is no separate url field. */
export function shareClipboardText(msg: ShareMessage): string {
  return `${msg.text}\n${msg.url}`;
}

/**
 * Shares a run, best path first.
 *
 * Web Share is the good path (real OS sheet, one tap to a chat app) and exists
 * in mobile browsers. The Android WebView that Capacitor runs does NOT implement
 * it, so the app falls to the clipboard — which works there because Capacitor
 * serves the game from an https origin, i.e. a secure context.
 *
 * `nav` is injected rather than read off the global so the outcomes are
 * testable; pass `navigator` from a browser caller.
 */
export async function shareRun(msg: ShareMessage, nav?: Navigator): Promise<ShareOutcome> {
  if (!nav) return 'unavailable';

  const data = { title: msg.title, text: msg.text, url: msg.url };

  const canUseSheet = typeof nav.share === 'function'
    && (typeof nav.canShare !== 'function' || nav.canShare(data));

  if (canUseSheet) {
    try {
      await nav.share(data);
      return 'shared';
    } catch (err) {
      // A dismissed sheet is a decision, not a failure: silently copying behind
      // the player's back after they backed out would be surprising.
      if ((err as { name?: string } | undefined)?.name === 'AbortError') return 'dismissed';
      // Anything else (permission, transient) is worth a clipboard fallback.
    }
  }

  if (typeof nav.clipboard?.writeText === 'function') {
    try {
      await nav.clipboard.writeText(shareClipboardText(msg));
      return 'copied';
    } catch {
      return 'unavailable';
    }
  }

  return 'unavailable';
}
