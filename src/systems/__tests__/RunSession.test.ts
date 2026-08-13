import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RunSession, RETRY_MS } from '../RunSession';
import { ScoreClient } from '../ScoreClient';

describe('RunSession', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(()  => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('stores the token when the first attempt succeeds', async () => {
    vi.spyOn(ScoreClient, 'openSession').mockResolvedValue('tok-1');
    const s = new RunSession();
    s.start('p1', 'h1');
    await vi.advanceTimersByTimeAsync(0);
    expect(s.getToken()).toBe('tok-1');
    s.stop();
  });

  it('retries every RETRY_MS until one succeeds', async () => {
    const spy = vi.spyOn(ScoreClient, 'openSession')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('tok-3');
    const s = new RunSession();
    s.start('p1', 'h1');

    await vi.advanceTimersByTimeAsync(0);
    expect(s.getToken()).toBeUndefined();

    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(s.getToken()).toBeUndefined();

    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(s.getToken()).toBe('tok-3');
    expect(spy).toHaveBeenCalledTimes(3);
    s.stop();
  });

  it('stops retrying once a token is held', async () => {
    const spy = vi.spyOn(ScoreClient, 'openSession').mockResolvedValue('tok-1');
    const s = new RunSession();
    s.start('p1', 'h1');
    await vi.advanceTimersByTimeAsync(RETRY_MS * 5);
    expect(spy).toHaveBeenCalledTimes(1);
    s.stop();
  });

  it('stops retrying after stop()', async () => {
    const spy = vi.spyOn(ScoreClient, 'openSession').mockResolvedValue(null);
    const s = new RunSession();
    s.start('p1', 'h1');
    await vi.advanceTimersByTimeAsync(0);
    s.stop();
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
    vi.spyOn(ScoreClient, 'openSession').mockResolvedValue('tok-1');
    const s = new RunSession();
    s.start('p1', 'h1');
    await vi.advanceTimersByTimeAsync(0);
    expect(s.getToken()).toBe('tok-1');
    s.start('p1', 'h2');
    expect(s.getToken()).toBeUndefined();
    s.stop();
  });
});
