import { describe, it, expect } from 'vitest';
import { NullLogger } from '../NullLogger';

describe('NullLogger', () => {
  it('does not throw on any method', () => {
    const log = new NullLogger();
    expect(() => log.error('x')).not.toThrow();
    expect(() => log.warn('y')).not.toThrow();
    expect(() => log.event({ type: 'user:created' })).not.toThrow();
    expect(() => log.setVerbose(true)).not.toThrow();
  });
});
