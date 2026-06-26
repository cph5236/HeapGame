/**
 * Regression test for Crash_Reports.md P2:
 * "Cannot read properties of null (reading 'drawImage')" in refreshYouStats.
 *
 * fetchPlayerScores() is a fire-and-forget async call started in create().
 * If the player leaves HeapSelectScene before the network request resolves,
 * the scene's rank Text objects are destroyed; the resolved callback then ran
 * refreshYouStats() → setColor() on a destroyed Text → null canvas crash.
 *
 * applyYouStats() must no-op once the scene is no longer active.
 */
import { describe, it, expect, vi } from 'vitest';
import { applyYouStats, type RankTextLike } from '../heapSelectStats';

function makeStubText() {
  const t: RankTextLike & { setText: ReturnType<typeof vi.fn>; setColor: ReturnType<typeof vi.fn> } = {
    setText: vi.fn(() => t),
    setColor: vi.fn(() => t),
  };
  return t;
}

describe('applyYouStats — teardown safety', () => {
  it('does not touch rank texts when the scene is no longer active', () => {
    const txt = makeStubText();
    applyYouStats(
      false,
      [{ id: 'h1' }],
      new Map([['h1', { rank: 3 }]]),
      () => txt,
    );
    expect(txt.setText).not.toHaveBeenCalled();
    expect(txt.setColor).not.toHaveBeenCalled();
  });

  it('writes the rank + accent colour for heaps the player has a score on', () => {
    const txt = makeStubText();
    applyYouStats(
      true,
      [{ id: 'h1' }],
      new Map([['h1', { rank: 3 }]]),
      () => txt,
    );
    expect(txt.setText).toHaveBeenCalledWith('Rank: #3');
    expect(txt.setColor).toHaveBeenCalledWith('#ffcc88');
  });

  it('writes the placeholder for heaps without a player score', () => {
    const txt = makeStubText();
    applyYouStats(
      true,
      [{ id: 'h1' }],
      new Map(),
      () => txt,
    );
    expect(txt.setText).toHaveBeenCalledWith('Rank: —');
    expect(txt.setColor).toHaveBeenCalledWith('#7799bb');
  });

  it('skips rows whose text object is missing', () => {
    expect(() =>
      applyYouStats(true, [{ id: 'h1' }], new Map(), () => undefined),
    ).not.toThrow();
  });
});
