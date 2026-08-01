import { describe, it, expect } from 'vitest';
import { parseOriginAllowlist } from '../src/middleware/originAllowlist';

describe('parseOriginAllowlist', () => {
  describe('wildcard mode', () => {
    it('treats a bare * as allow-all', () => {
      const list = parseOriginAllowlist('*');
      expect(list.allowAll).toBe(true);
      expect(list.allows('https://anything.example.com')).toBe(true);
    });

    it('defaults to allow-all when undefined', () => {
      expect(parseOriginAllowlist(undefined).allowAll).toBe(true);
    });

    it('tolerates surrounding whitespace on the bare wildcard', () => {
      expect(parseOriginAllowlist('  *  ').allowAll).toBe(true);
    });
  });

  describe('exact entries', () => {
    const list = parseOriginAllowlist(
      'https://heapgame.com, capacitor://localhost ,https://localhost',
    );

    it('is not allow-all', () => {
      expect(list.allowAll).toBe(false);
    });

    it('matches each listed origin, trimming whitespace', () => {
      expect(list.allows('https://heapgame.com')).toBe(true);
      expect(list.allows('capacitor://localhost')).toBe(true);
      expect(list.allows('https://localhost')).toBe(true);
    });

    it('rejects an unlisted origin', () => {
      expect(list.allows('https://attacker.example.com')).toBe(false);
    });

    it('rejects a scheme mismatch on an exact entry', () => {
      expect(list.allows('http://heapgame.com')).toBe(false);
    });
  });

  describe('subdomain wildcards (itch.io randomized hosts)', () => {
    const list = parseOriginAllowlist('https://heapgame.com,https://*.hwcdn.net');

    it('matches a multi-label randomized subdomain', () => {
      expect(list.allows('https://v6p9d9t4.ssl.hwcdn.net')).toBe(true);
    });

    it('matches a single-label subdomain', () => {
      expect(list.allows('https://foo.hwcdn.net')).toBe(true);
    });

    it('still matches exact entries alongside the wildcard', () => {
      expect(list.allows('https://heapgame.com')).toBe(true);
    });

    it('rejects the bare apex with no subdomain', () => {
      expect(list.allows('https://hwcdn.net')).toBe(false);
    });

    it('rejects a lookalike that is not on a label boundary', () => {
      expect(list.allows('https://evilhwcdn.net')).toBe(false);
    });

    it('rejects a suffix-extension attack', () => {
      expect(list.allows('https://foo.hwcdn.net.evil.com')).toBe(false);
    });

    it('rejects a scheme downgrade', () => {
      expect(list.allows('http://foo.hwcdn.net')).toBe(false);
    });

    it('rejects an origin carrying an explicit port', () => {
      expect(list.allows('https://foo.hwcdn.net:8443')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('ignores empty entries from stray commas', () => {
      const list = parseOriginAllowlist('https://heapgame.com,,');
      expect(list.allows('https://heapgame.com')).toBe(true);
      expect(list.allows('')).toBe(false);
    });

    it('matches origins case-insensitively through a wildcard', () => {
      const list = parseOriginAllowlist('https://*.HWCDN.net');
      expect(list.allows('https://Foo.Hwcdn.Net')).toBe(true);
    });

    it('allows nothing when the list is empty', () => {
      const list = parseOriginAllowlist('');
      expect(list.allowAll).toBe(false);
      expect(list.allows('https://heapgame.com')).toBe(false);
    });
  });
});
