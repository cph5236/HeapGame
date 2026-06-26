/**
 * Pure logic for HeapSelectScene's "You" rank column, extracted so it can be
 * unit-tested without a live Phaser scene (the scene classes import Phaser as a
 * value, which the Node test env can't load — see menuIntro.ts for the same
 * pattern).
 *
 * The `active` guard is the crash fix for Crash_Reports.md P2: the player-score
 * fetch is fire-and-forget, so its callback can land after the scene has been
 * torn down. Touching a destroyed Phaser Text object there crashes inside
 * updateText → updateUVs (null canvas). Bail out when the scene is gone.
 */

/** Minimal Phaser.GameObjects.Text surface used by the rank column. */
export interface RankTextLike {
  setText(text: string): RankTextLike;
  setColor(color: string): RankTextLike;
}

interface HeapLike { id: string }
interface ScoreLike { rank: number }

const ACCENT_RANKED = '#ffcc88';
const ACCENT_PLACEHOLDER = '#7799bb';

export function applyYouStats(
  active: boolean,
  sorted: readonly HeapLike[],
  scores: ReadonlyMap<string, ScoreLike>,
  getText: (rowIndex: number) => RankTextLike | undefined,
): void {
  // Scene torn down before the async score fetch resolved — its Text objects
  // are destroyed; do nothing rather than crash mutating them.
  if (!active) return;

  sorted.forEach((heap, i) => {
    const txt = getText(i);
    if (!txt) return;
    const entry = scores.get(heap.id);
    if (!entry) {
      txt.setText('Rank: —').setColor(ACCENT_PLACEHOLDER);
      return;
    }
    txt.setText(`Rank: #${entry.rank}`).setColor(ACCENT_RANKED);
  });
}
