import { describe, it, expect, vi } from 'vitest';
import {
  buildShareMessage, shareClipboardText, shareRun, SHARE_URL,
} from '../shareRun';

const base = {
  score: 1234,
  heapName: 'Rust Belt',
  isInfinite: false,
  isNewHighScore: false,
  isPeak: false,
};

describe('buildShareMessage', () => {
  it('names the heap and the score on an ordinary run', () => {
    const msg = buildShareMessage(base);
    expect(msg.text).toContain('1,234');
    expect(msg.text).toContain('Rust Belt');
    expect(msg.url).toBe(SHARE_URL);
  });

  it('leads with the summit when the run topped out', () => {
    const msg = buildShareMessage({ ...base, isPeak: true });
    expect(msg.text).toMatch(/topped out/i);
    expect(msg.text).toContain('Rust Belt');
  });

  it('leads with the personal best when the run set one', () => {
    const msg = buildShareMessage({ ...base, isNewHighScore: true });
    expect(msg.text).toMatch(/best/i);
  });

  it('prefers the summit line over the personal-best line', () => {
    const msg = buildShareMessage({ ...base, isPeak: true, isNewHighScore: true });
    expect(msg.text).toMatch(/topped out/i);
  });

  it('calls the infinite heap endless rather than naming it', () => {
    const msg = buildShareMessage({ ...base, isInfinite: true, heapName: 'Infinite' });
    expect(msg.text).toMatch(/endless/i);
    expect(msg.text).not.toContain('Infinite');
  });

  it('thousands-separates large scores', () => {
    expect(buildShareMessage({ ...base, score: 1234567 }).text).toContain('1,234,567');
  });

  it('falls back to a generic pile when the heap has no usable name', () => {
    const msg = buildShareMessage({ ...base, heapName: '   ' });
    expect(msg.text).toMatch(/the heap/i);
    expect(msg.text).toContain('1,234');
  });

  it('carries a ref param so share traffic is attributable', () => {
    expect(SHARE_URL).toContain('ref=run');
  });
});

describe('shareClipboardText', () => {
  it('joins the pitch and the url into one pasteable block', () => {
    const text = shareClipboardText(buildShareMessage(base));
    expect(text).toContain('1,234');
    expect(text.endsWith(SHARE_URL)).toBe(true);
  });
});

describe('shareRun', () => {
  const msg = buildShareMessage(base);

  it('uses the native sheet when the platform has one', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const nav = { share } as unknown as Navigator;
    await expect(shareRun(msg, nav)).resolves.toBe('shared');
    expect(share).toHaveBeenCalledWith({ title: msg.title, text: msg.text, url: msg.url });
  });

  it('reports a dismissed sheet without falling back to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const nav = {
      share: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'AbortError' })),
      clipboard: { writeText },
    } as unknown as Navigator;
    await expect(shareRun(msg, nav)).resolves.toBe('dismissed');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('falls back to the clipboard when the native sheet errors', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const nav = {
      share: vi.fn().mockRejectedValue(new Error('not allowed')),
      clipboard: { writeText },
    } as unknown as Navigator;
    await expect(shareRun(msg, nav)).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith(shareClipboardText(msg));
  });

  it('copies when there is no native sheet at all (Android WebView)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const nav = { clipboard: { writeText } } as unknown as Navigator;
    await expect(shareRun(msg, nav)).resolves.toBe('copied');
  });

  it('skips the native sheet when canShare rejects the payload', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const share = vi.fn();
    const nav = {
      share,
      canShare: vi.fn().mockReturnValue(false),
      clipboard: { writeText },
    } as unknown as Navigator;
    await expect(shareRun(msg, nav)).resolves.toBe('copied');
    expect(share).not.toHaveBeenCalled();
  });

  it('reports unavailable when neither path exists', async () => {
    await expect(shareRun(msg, {} as Navigator)).resolves.toBe('unavailable');
  });

  it('reports unavailable when the clipboard write itself fails', async () => {
    const nav = {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    } as unknown as Navigator;
    await expect(shareRun(msg, nav)).resolves.toBe('unavailable');
  });

  it('is a no-op with no navigator at all (node/vitest)', async () => {
    await expect(shareRun(msg, undefined)).resolves.toBe('unavailable');
  });
});
