import { describe, it, expect } from 'vitest';
import { normalizeAdId } from '../adId';

const REAL = 'ca-app-pub-9580963584294486/4249681864';

describe('normalizeAdId', () => {
  // The bug this exists for: the VITE_ADMOB_REWARDED_ID CI secret was stored with
  // a trailing newline, so the GMA SDK rejected every load with
  // "Cannot determine request type" / ERROR_CODE_INVALID_REQUEST.
  it('strips a trailing newline baked in by a CI secret', () => {
    expect(normalizeAdId(`${REAL}\n`)).toBe(REAL);
  });

  it('strips surrounding whitespace and CRLF', () => {
    expect(normalizeAdId(`  ${REAL}\r\n`)).toBe(REAL);
  });

  it('leaves a clean id untouched', () => {
    expect(normalizeAdId(REAL)).toBe(REAL);
  });

  it('returns an empty string for undefined', () => {
    expect(normalizeAdId(undefined)).toBe('');
  });
});
