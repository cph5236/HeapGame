import { describe, it, expect, vi } from 'vitest';
import { createAdGate } from '../adGate';

/** A promise whose resolution the test controls, standing in for the ad. */
const deferred = () => {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('createAdGate', () => {
  it('runs the transition only after the ad closes', async () => {
    const ad = deferred();
    const transition = vi.fn();
    const { leave } = createAdGate(() => ad.promise);

    const pending = leave(true, transition);
    await Promise.resolve();
    expect(transition).not.toHaveBeenCalled();

    ad.resolve();
    await pending;
    expect(transition).toHaveBeenCalledOnce();
  });

  it('runs the transition immediately when no ad is due', async () => {
    const showAd = vi.fn();
    const transition = vi.fn();

    await createAdGate(showAd).leave(false, transition);

    expect(showAd).not.toHaveBeenCalled();
    expect(transition).toHaveBeenCalledOnce();
  });

  it('ignores a second exit while the ad is on screen', async () => {
    const ad = deferred();
    const showAd = vi.fn(() => ad.promise);
    const playAgain = vi.fn();
    const goMenu = vi.fn();
    const { leave } = createAdGate(showAd);

    const pending = leave(true, playAgain);
    await leave(true, goMenu);   // tap on the menu zone while the ad is up

    ad.resolve();
    await pending;

    expect(showAd).toHaveBeenCalledOnce();
    expect(playAgain).toHaveBeenCalledOnce();
    expect(goMenu).not.toHaveBeenCalled();
  });

  it('still transitions when the ad rejects', async () => {
    const transition = vi.fn();
    const { leave } = createAdGate(() => Promise.reject(new Error('no fill')));

    await leave(true, transition);

    expect(transition).toHaveBeenCalledOnce();
  });
});

describe('createAdGate exclusivity with the rewarded offer', () => {
  // The rewarded button and PLAY AGAIN are on screen together on an ad run, and
  // the score screen stays interactive while a rewarded ad is still loading. A
  // tap on each used to fire showRewarded() and showInterstitial() concurrently.
  it('refuses an exit while a rewarded ad holds the gate', async () => {
    const showAd = vi.fn(() => Promise.resolve());
    const transition = vi.fn();
    const gate = createAdGate(showAd);

    expect(gate.claim()).toBe(true);
    await gate.leave(true, transition);

    expect(showAd).not.toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();
  });

  it('allows the exit once the rewarded ad releases the gate', async () => {
    const transition = vi.fn();
    const gate = createAdGate(() => Promise.resolve());

    gate.claim();
    gate.release();
    await gate.leave(true, transition);

    expect(transition).toHaveBeenCalledOnce();
  });

  it('refuses a rewarded claim while the exit ad is on screen', async () => {
    const ad = deferred();
    const gate = createAdGate(() => ad.promise);

    const pending = gate.leave(true, vi.fn());
    await Promise.resolve();
    expect(gate.claim()).toBe(false);

    ad.resolve();
    await pending;
  });

  it('refuses a rewarded claim once the scene has left', async () => {
    const gate = createAdGate(() => Promise.resolve());
    await gate.leave(false, vi.fn());

    expect(gate.claim()).toBe(false);
  });
});
