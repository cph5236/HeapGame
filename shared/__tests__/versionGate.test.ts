import { describe, it, expect } from 'vitest';
import {
  parseVersion,
  compareVersions,
  parseMinVersionConfig,
  isUpdateRequired,
  MAX_GATE_MESSAGE_LENGTH,
} from '../versionGate';

describe('parseVersion', () => {
  it('parses a full three-part version', () => {
    expect(parseVersion('0.2.20')).toEqual([0, 2, 20]);
  });

  it('defaults missing segments to zero', () => {
    expect(parseVersion('1')).toEqual([1, 0, 0]);
    expect(parseVersion('0.2')).toEqual([0, 2, 0]);
  });

  it('ignores a prerelease/build suffix so -debug builds still compare', () => {
    expect(parseVersion('0.2.20-debug')).toEqual([0, 2, 20]);
    expect(parseVersion('0.2.20+ci.4')).toEqual([0, 2, 20]);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseVersion('  0.2.20 ')).toEqual([0, 2, 20]);
  });

  it('returns null for non-version input', () => {
    for (const bad of ['', 'v1.2.3', '1.2.3.4', '1.x.3', 'latest', '-1.0.0', null, undefined, 3, {}]) {
      expect(parseVersion(bad)).toBeNull();
    }
  });
});

describe('compareVersions', () => {
  it('compares segments numerically, not lexicographically', () => {
    // The bug a string compare would introduce: '0.2.9' > '0.2.10' as text.
    expect(compareVersions('0.2.9', '0.2.10')).toBeLessThan(0);
    expect(compareVersions('0.2.10', '0.2.9')).toBeGreaterThan(0);
  });

  it('orders by major, then minor, then patch', () => {
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0);
    expect(compareVersions('0.3.0', '0.2.99')).toBeGreaterThan(0);
    expect(compareVersions('0.2.20', '0.2.20')).toBe(0);
  });

  it('treats missing segments as zero', () => {
    expect(compareVersions('0.2', '0.2.0')).toBe(0);
  });

  it('returns null when either side is unparseable', () => {
    expect(compareVersions('nonsense', '0.2.0')).toBeNull();
    expect(compareVersions('0.2.0', 'nonsense')).toBeNull();
  });
});

describe('parseMinVersionConfig', () => {
  it('accepts a bare version', () => {
    expect(parseMinVersionConfig({ version: '0.2.21' })).toEqual({ version: '0.2.21' });
  });

  it('accepts a version with a message', () => {
    expect(parseMinVersionConfig({ version: '0.2.21', message: 'Scores are broken.' }))
      .toEqual({ version: '0.2.21', message: 'Scores are broken.' });
  });

  it('drops unknown extra fields rather than passing them through', () => {
    expect(parseMinVersionConfig({ version: '0.2.21', rogue: 'x' })).toEqual({ version: '0.2.21' });
  });

  it('requires an exact three-part version', () => {
    for (const bad of ['0.2', '1', 'v0.2.21', '0.2.21-debug', '>=0.2.21', '']) {
      expect(parseMinVersionConfig({ version: bad })).toBeNull();
    }
  });

  it('rejects non-object values', () => {
    for (const bad of ['0.2.21', 42, null, undefined, ['0.2.21'], true]) {
      expect(parseMinVersionConfig(bad)).toBeNull();
    }
  });

  it('rejects a missing version', () => {
    expect(parseMinVersionConfig({ message: 'update please' })).toBeNull();
  });

  it('rejects a non-string or over-long message', () => {
    expect(parseMinVersionConfig({ version: '0.2.21', message: 5 })).toBeNull();
    expect(parseMinVersionConfig({
      version: '0.2.21',
      message: 'x'.repeat(MAX_GATE_MESSAGE_LENGTH + 1),
    })).toBeNull();
    expect(parseMinVersionConfig({
      version: '0.2.21',
      message: 'x'.repeat(MAX_GATE_MESSAGE_LENGTH),
    })).not.toBeNull();
  });
});

describe('isUpdateRequired', () => {
  it('blocks a client below the floor', () => {
    expect(isUpdateRequired('0.2.20', { version: '0.2.21' })).toBe(true);
  });

  it('allows a client at or above the floor', () => {
    expect(isUpdateRequired('0.2.21', { version: '0.2.21' })).toBe(false);
    expect(isUpdateRequired('0.3.0', { version: '0.2.21' })).toBe(false);
  });

  it('allows an Android debug build of the floor version', () => {
    expect(isUpdateRequired('0.2.21-debug', { version: '0.2.21' })).toBe(false);
  });

  // Fail-open contract: anything we are not sure about must not lock a player out.
  it('fails open when there is no config', () => {
    expect(isUpdateRequired('0.2.20', undefined)).toBe(false);
    expect(isUpdateRequired('0.2.20', null)).toBe(false);
  });

  it('fails open when the config is malformed', () => {
    expect(isUpdateRequired('0.2.20', { version: 'tomorrow' })).toBe(false);
    expect(isUpdateRequired('0.2.20', '0.2.21')).toBe(false);
    expect(isUpdateRequired('0.2.20', {})).toBe(false);
  });

  it('fails open when the client version is unparseable', () => {
    expect(isUpdateRequired('dev', { version: '0.2.21' })).toBe(false);
    expect(isUpdateRequired(undefined, { version: '0.2.21' })).toBe(false);
  });
});
