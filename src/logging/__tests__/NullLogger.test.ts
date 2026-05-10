import { describe, it, expect } from 'vitest';
import { NullLogger } from '../NullLogger';
import { getLogger, setLogger, _resetLoggerForTests } from '../index';

describe('NullLogger', () => {
  it('does not throw on any method', () => {
    const log = new NullLogger();
    expect(() => log.error('x')).not.toThrow();
    expect(() => log.warn('y')).not.toThrow();
    expect(() => log.event({ type: 'user:created' })).not.toThrow();
    expect(() => log.setVerbose(true)).not.toThrow();
  });
});

describe('getLogger', () => {
  it('returns a NullLogger by default', () => {
    _resetLoggerForTests();
    expect(() => getLogger().error('hi')).not.toThrow();
  });

  it('returns the logger set via setLogger', () => {
    const calls: string[] = [];
    setLogger({
      error: (m) => calls.push(m),
      warn: () => {},
      event: () => {},
      setVerbose: () => {},
    });
    getLogger().error('boom');
    expect(calls).toEqual(['boom']);
    _resetLoggerForTests();
  });
});
