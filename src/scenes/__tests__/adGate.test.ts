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
    const leave = createAdGate(() => ad.promise);

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

    await createAdGate(showAd)(false, transition);

    expect(showAd).not.toHaveBeenCalled();
    expect(transition).toHaveBeenCalledOnce();
  });

  it('ignores a second exit while the ad is on screen', async () => {
    const ad = deferred();
    const showAd = vi.fn(() => ad.promise);
    const playAgain = vi.fn();
    const goMenu = vi.fn();
    const leave = createAdGate(showAd);

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
    const leave = createAdGate(() => Promise.reject(new Error('no fill')));

    await leave(true, transition);

    expect(transition).toHaveBeenCalledOnce();
  });
});
