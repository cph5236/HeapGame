import { describe, it, expect } from 'vitest';
import { validatePlayerName, generateDefaultPlayerName, MAX_PLAYER_NAME_LEN } from '../playerName';

describe('validatePlayerName', () => {
  it('accepts a plain name and returns it trimmed', () => {
    expect(validatePlayerName('  Connor  ')).toEqual({ ok: true, name: 'Connor' });
  });
  it('accepts names at exactly 20 chars', () => {
    const n = 'a'.repeat(MAX_PLAYER_NAME_LEN);
    expect(validatePlayerName(n)).toEqual({ ok: true, name: n });
  });
  it('rejects empty / whitespace-only', () => {
    expect(validatePlayerName('   ')).toEqual({ ok: false, reason: 'empty' });
  });
  it('rejects names over 20 chars (post-trim)', () => {
    expect(validatePlayerName('a'.repeat(21))).toEqual({ ok: false, reason: 'too-long' });
  });
  it('rejects profanity', () => {
    expect(validatePlayerName('shithead')).toEqual({ ok: false, reason: 'profanity' });
  });
  it('rejects leet-speak obfuscation', () => {
    expect(validatePlayerName('sh1thead')).toEqual({ ok: false, reason: 'profanity' });
  });
  it('does not false-positive on clean words', () => {
    expect(validatePlayerName('Classy Grass')).toEqual({ ok: true, name: 'Classy Grass' });
    expect(validatePlayerName('Trashbag#12345').ok).toBe(true);
  });
});

describe('generateDefaultPlayerName', () => {
  it('matches Trashbag#NNNNN', () => {
    expect(generateDefaultPlayerName()).toMatch(/^Trashbag#\d{5}$/);
  });
  it('passes its own validation', () => {
    expect(validatePlayerName(generateDefaultPlayerName()).ok).toBe(true);
  });
});
