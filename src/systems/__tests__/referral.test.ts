import { describe, it, expect, vi } from 'vitest';
import { parseRef, shouldRecordRef, recordReferral, REF_STORAGE_KEY } from '../referral';

describe('parseRef', () => {
  it('pulls the ref value out of a query string', () => {
    expect(parseRef('?ref=run')).toBe('run');
  });

  it('reads it alongside other params, in any position', () => {
    expect(parseRef('?utm_source=x&ref=run&z=1')).toBe('run');
  });

  it('returns null when there is no ref', () => {
    expect(parseRef('?dev=ScoreScene')).toBeNull();
    expect(parseRef('')).toBeNull();
    expect(parseRef('?ref=')).toBeNull();
  });

  it('lowercases so ?ref=Run and ?ref=run are one source', () => {
    expect(parseRef('?ref=RUN')).toBe('run');
  });

  it('rejects values outside the safe charset rather than logging them', () => {
    // The value is attacker-controllable via a crafted url and ends up in a log
    // payload, so anything unexpected is dropped, not sanitized-and-kept.
    expect(parseRef('?ref=run%20now')).toBeNull();
    expect(parseRef('?ref=<script>')).toBeNull();
    expect(parseRef('?ref=a;b')).toBeNull();
  });

  it('accepts the conventional marker charset', () => {
    expect(parseRef('?ref=play_store-2')).toBe('play_store-2');
  });

  it('rejects an over-long value instead of truncating it', () => {
    expect(parseRef(`?ref=${'a'.repeat(33)}`)).toBeNull();
    expect(parseRef(`?ref=${'a'.repeat(32)}`)).toBe('a'.repeat(32));
  });
});

describe('shouldRecordRef', () => {
  it('records a first-touch arrival', () => {
    expect(shouldRecordRef('run', null)).toBe(true);
  });

  it('ignores a visit with no ref', () => {
    expect(shouldRecordRef(null, null)).toBe(false);
  });

  it('does not re-record a player who already arrived once', () => {
    // First-touch attribution: a returning player clicking another shared link
    // is not a new acquisition, and counting them would inflate the loop.
    expect(shouldRecordRef('run', 'run')).toBe(false);
    expect(shouldRecordRef('run', 'itch')).toBe(false);
  });
});

describe('recordReferral', () => {
  const store = (initial: string | null) => {
    const map = new Map<string, string>();
    if (initial !== null) map.set(REF_STORAGE_KEY, initial);
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => { map.set(k, v); },
      map,
    };
  };

  it('emits the arrival and remembers it', () => {
    const emit = vi.fn();
    const s = store(null);
    recordReferral('?ref=run', s as unknown as Storage, emit);
    expect(emit).toHaveBeenCalledWith({ type: 'visit:referred', ref: 'run' });
    expect(s.map.get(REF_STORAGE_KEY)).toBe('run');
  });

  it('stays silent on a repeat visit', () => {
    const emit = vi.fn();
    recordReferral('?ref=run', store('run') as unknown as Storage, emit);
    expect(emit).not.toHaveBeenCalled();
  });

  it('stays silent on an ordinary visit with no ref', () => {
    const emit = vi.fn();
    const s = store(null);
    recordReferral('', s as unknown as Storage, emit);
    expect(emit).not.toHaveBeenCalled();
    expect(s.map.size).toBe(0);
  });

  it('survives storage that throws (private mode, blocked cookies)', () => {
    const emit = vi.fn();
    const hostile = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    } as unknown as Storage;
    // Must not take the boot sequence down with it.
    expect(() => recordReferral('?ref=run', hostile, emit)).not.toThrow();
  });

  it('is a no-op with no storage at all', () => {
    const emit = vi.fn();
    expect(() => recordReferral('?ref=run', undefined, emit)).not.toThrow();
  });
});
