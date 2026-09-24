import { describe, it, expect } from 'vitest';
import { resolveMenuStart, heapPickerLabel } from '../menuStartRoute';

describe('resolveMenuStart', () => {
  it('starts the tutorial while it is pending, whatever heap is loaded behind it', () => {
    expect(resolveMenuStart({ tutorialPending: true, identitySettled: true, isInfinite: false, hasCheckpoint: true }))
      .toEqual({ scene: 'TutorialScene' });
    expect(resolveMenuStart({ tutorialPending: true, identitySettled: true, isInfinite: true, hasCheckpoint: false }))
      .toEqual({ scene: 'TutorialScene' });
  });

  it('starts Infinite mode for an infinite heap', () => {
    expect(resolveMenuStart({ tutorialPending: false, identitySettled: true, isInfinite: true, hasCheckpoint: false }))
      .toEqual({ scene: 'InfiniteGameScene' });
  });

  it('starts a finite run, resuming from a checkpoint when one has spawns left', () => {
    expect(resolveMenuStart({ tutorialPending: false, identitySettled: true, isInfinite: false, hasCheckpoint: true }))
      .toEqual({ scene: 'GameScene', useCheckpoint: true });
    expect(resolveMenuStart({ tutorialPending: false, identitySettled: true, isInfinite: false, hasCheckpoint: false }))
      .toEqual({ scene: 'GameScene', useCheckpoint: false });
  });
});

describe('resolveMenuStart before the identity session settles', () => {
  // A reinstalling GPGS player boots with a fresh local save (tutorialDone
  // false); the cloud save that says otherwise only merges once sign-in settles.
  it('holds a tutorial start until the cloud-save merge has had its chance', () => {
    expect(resolveMenuStart({ tutorialPending: true, identitySettled: false, isInfinite: false, hasCheckpoint: false }))
      .toEqual({ scene: null });
  });

  it('does not hold a normal run — only the tutorial decision depends on the merge', () => {
    expect(resolveMenuStart({ tutorialPending: false, identitySettled: false, isInfinite: false, hasCheckpoint: false }))
      .toEqual({ scene: 'GameScene', useCheckpoint: false });
  });
});

describe('heapPickerLabel', () => {
  const base = { name: 'Landfill', difficulty: 2, catalogReady: true, tutorialPending: false };

  it('shows the loaded heap once the catalog is ready', () => {
    const l = heapPickerLabel(base);
    expect(l.name).toContain('Landfill');
    expect(l.stars).not.toBe('');
    expect(l.dim).toBe(false);
    expect(l.leaderboardEnabled).toBe(true);
  });

  it('shows a dimmed loading placeholder before the catalog lands', () => {
    const l = heapPickerLabel({ ...base, catalogReady: false });
    expect(l.name).toMatch(/loading/i);
    expect(l.stars).toBe('');
    expect(l.dim).toBe(true);
    expect(l.leaderboardEnabled).toBe(false);
  });

  it('shows Tutorial with no stars or leaderboard while the tutorial is pending', () => {
    const l = heapPickerLabel({ ...base, tutorialPending: true });
    expect(l.name).toContain('Tutorial');
    expect(l.name).not.toContain('Landfill');
    expect(l.stars).toBe('');
    expect(l.dim).toBe(false);
    expect(l.leaderboardEnabled).toBe(false);
  });

  it('shows Tutorial even before the catalog lands — it does not depend on it', () => {
    const l = heapPickerLabel({ ...base, catalogReady: false, tutorialPending: true });
    expect(l.name).toContain('Tutorial');
    expect(l.dim).toBe(false);
  });
});
