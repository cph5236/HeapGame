import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RunSession, RETRY_MS, EARLY_RETRY_MS } from '../RunSession';
import { ScoreClient } from '../ScoreClient';

type OpenResult = Awaited<ReturnType<typeof ScoreClient.openSession>>;

/** A token was issued. */
const ok        = (token: string): OpenResult => ({ token, retryable: false });
/** Failed, but retrying could still succeed (network blip, 429, 5xx). */
const transient = (): OpenResult => ({ token: null, retryable: true });
/** Failed in a way retrying can never fix (404 no secret, 403 mismatch). */
const permanent = (): OpenResult => ({ token: null, retryable: false });

describe('RunSession', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(()  => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('stores the token when the first attempt succeeds', async () => {
    vi.spyOn(ScoreClient, 'openSession').mockResolvedValue(ok('tok-1'));
    const s = new RunSession();
    s.start('p1', 'h1');
    await vi.advanceTimersByTimeAsync(0);
    expect(s.getToken()).toBe('tok-1');
    s.stop();
  });

  it('retries on the early schedule, then backs off to RETRY_MS', async () => {
    const spy = vi.spyOn(ScoreClient, 'openSession').mockResolvedValue(transient());
    const s = new RunSession();
    s.start('p1', 'h1');

    await vi.advanceTimersByTimeAsync(0);
    expect(spy).toHaveBeenCalledTimes(1);

    // Attempts 2 and 3 land on EARLY_RETRY_MS: +1s, then +3s.
    await vi.advanceTimersByTimeAsync(EARLY_RETRY_MS[0]);
    expect(spy).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(EARLY_RETRY_MS[1]);
    expect(spy).toHaveBeenCalledTimes(3);

    // The schedule is spent — attempt 4 waits the full RETRY_MS, so nothing
    // fires just short of it.
    await vi.advanceTimersByTimeAsync(RETRY_MS - 1);
    expect(spy).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(1);
    expect(spy).toHaveBeenCalledTimes(4);
    s.stop();
  });

  it('holds a token within a short run despite a failed first attempt', async () => {
    // The reason for the early schedule. A tokenless submit is rejected
    // outright rather than clamped, so a run that ends inside the retry gap
    // loses its score entirely. Under a flat 15s schedule this expectation
    // fails: at 5s the second attempt has not yet fired.
    const spy = vi.spyOn(ScoreClient, 'openSession')
      .mockResolvedValueOnce(transient())
      .mockResolvedValue(ok('tok-2'));
    const s = new RunSession();
    s.start('p1', 'h1');

    await vi.advanceTimersByTimeAsync(5_000);
    expect(s.getToken()).toBe('tok-2');
    expect(spy).toHaveBeenCalledTimes(2);
    s.stop();
  });

  it('stops retrying once a token is held', async () => {
    const spy = vi.spyOn(ScoreClient, 'openSession').mockResolvedValue(ok('tok-1'));
    const s = new RunSession();
    s.start('p1', 'h1');
    await vi.advanceTimersByTimeAsync(RETRY_MS * 5);
    expect(spy).toHaveBeenCalledTimes(1);
    s.stop();
  });

  it('stops retrying after a permanent failure', async () => {
    // A 404 means the server has no SESSION_SECRET configured. Polling it for
    // the whole scene multiplies session traffic for an answer that cannot
    // change — this is the pre-enable deployment window and local dev.
    const spy = vi.spyOn(ScoreClient, 'openSession').mockResolvedValue(permanent());
    const s = new RunSession();
    s.start('p1', 'h1');
    await vi.advanceTimersByTimeAsync(RETRY_MS * 5);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(s.getToken()).toBeUndefined();
    s.stop();
  });

  it('keeps retrying a transient failure', async () => {
    const spy = vi.spyOn(ScoreClient, 'openSession').mockResolvedValue(transient());
    const s = new RunSession();
    s.start('p1', 'h1');
    // t=0 immediate, +1s, +3s, then every 15s: 1s, 4s, 19s, 34s within 45s.
    await vi.advanceTimersByTimeAsync(RETRY_MS * 3);
    expect(spy).toHaveBeenCalledTimes(5);
    s.stop();
  });

  it('does not fire a second request while one is still in flight', async () => {
    // A request slower than RETRY_MS would otherwise stack up concurrent
    // requests, doubling rate-limit consumption for no benefit.
    const spy = vi.spyOn(ScoreClient, 'openSession')
      .mockReturnValue(new Promise<OpenResult>(() => { /* never settles */ }));
    const s = new RunSession();
    s.start('p1', 'h1');
    await vi.advanceTimersByTimeAsync(RETRY_MS * 4);
    expect(spy).toHaveBeenCalledTimes(1);
    s.stop();
  });

  it('resumes retrying after an in-flight request finally settles', async () => {
    let settleFirst!: (r: OpenResult) => void;
    const pending = new Promise<OpenResult>((resolve) => { settleFirst = resolve; });
    const spy = vi.spyOn(ScoreClient, 'openSession')
      .mockReturnValueOnce(pending)
      .mockResolvedValue(ok('tok-later'));

    const s = new RunSession();
    s.start('p1', 'h1');
    await vi.advanceTimersByTimeAsync(RETRY_MS * 2);
    expect(spy).toHaveBeenCalledTimes(1); // nothing scheduled until this settles

    settleFirst(transient());
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(s.getToken()).toBe('tok-later');
    s.stop();
  });

  it('stops retrying after stop()', async () => {
    const spy = vi.spyOn(ScoreClient, 'openSession').mockResolvedValue(transient());
    const s = new RunSession();
    s.start('p1', 'h1');
    await vi.advanceTimersByTimeAsync(0);
    s.stop();
    await vi.advanceTimersByTimeAsync(RETRY_MS * 5);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not restart the loop when a request settles after stop()', async () => {
    // Retries are scheduled by a settling request rather than by a standing
    // interval, so stop() clearing the timer is not sufficient on its own: the
    // request already in flight at scene shutdown settles afterwards and must
    // not schedule anything behind the dead scene.
    let settle!: (r: OpenResult) => void;
    const pending = new Promise<OpenResult>((resolve) => { settle = resolve; });
    const spy = vi.spyOn(ScoreClient, 'openSession')
      .mockReturnValueOnce(pending)
      .mockResolvedValue(transient());

    const s = new RunSession();
    s.start('p1', 'h1');
    s.stop();

    settle(transient());
    await vi.advanceTimersByTimeAsync(RETRY_MS * 5);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not throw when openSession rejects', async () => {
    vi.spyOn(ScoreClient, 'openSession').mockRejectedValue(new Error('offline'));
    const s = new RunSession();
    expect(() => s.start('p1', 'h1')).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.getToken()).toBeUndefined();
    s.stop();
  });

  it('discards a token from a previous start after restart', async () => {
    vi.spyOn(ScoreClient, 'openSession').mockResolvedValue(ok('tok-1'));
    const s = new RunSession();
    s.start('p1', 'h1');
    await vi.advanceTimersByTimeAsync(0);
    expect(s.getToken()).toBe('tok-1');
    s.start('p1', 'h2');
    expect(s.getToken()).toBeUndefined();
    s.stop();
  });

  it('ignores a stale in-flight promise from a superseded start() and keeps the new loop alive', async () => {
    let resolveFirst!: (r: OpenResult) => void;
    const firstCall = new Promise<OpenResult>((resolve) => { resolveFirst = resolve; });

    const spy = vi.spyOn(ScoreClient, 'openSession')
      .mockReturnValueOnce(firstCall)          // h1's attempt — left in flight
      .mockResolvedValueOnce(transient());     // h2's first attempt — fails

    const s = new RunSession();
    s.start('p1', 'h1');   // attempt A fires, stays pending
    s.start('p1', 'h2');   // supersedes A before it resolves; attempt B fires

    await vi.advanceTimersByTimeAsync(0);  // let B's attempt settle
    expect(s.getToken()).toBeUndefined();

    // A finally resolves with h1's token, after being superseded.
    resolveFirst(ok('tok-h1'));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.getToken()).toBeUndefined();
    expect(s.getToken()).not.toBe('tok-h1');

    // B's retry loop must still be alive — A's late resolution must not have
    // called stop() on B's interval.
    spy.mockResolvedValueOnce(ok('tok-h2-retry'));
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(s.getToken()).toBe('tok-h2-retry');

    s.stop();
  });
});
