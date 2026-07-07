import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Logger } from '../../../shared/logging/Logger';

vi.mock('../SaveData', () => ({
  getPlayerSecret: () => 'secret-123',
}));

import { authHeaders, logIfAuthRejected } from '../authToken';
import { setLogger, _resetLoggerForTests } from '../../logging';

afterEach(() => _resetLoggerForTests());

function spyLogger() {
  const error = vi.fn();
  const logger: Logger = { error, warn: vi.fn(), event: vi.fn(), setVerbose: vi.fn() };
  setLogger(logger);
  return { error };
}

describe('authHeaders', () => {
  it('returns the X-Player-Token header with the player secret', () => {
    expect(authHeaders()).toEqual({ 'X-Player-Token': 'secret-123' });
  });
});

describe('logIfAuthRejected', () => {
  it('logs an error-level auth:rejected event on 403', () => {
    const { error } = spyLogger();
    logIfAuthRejected('scores:submit', 403);
    expect(error).toHaveBeenCalledWith('auth:rejected', { route: 'scores:submit', status: 403 });
  });

  it('does nothing for other statuses', () => {
    const { error } = spyLogger();
    logIfAuthRejected('scores:submit', 500);
    logIfAuthRejected('scores:submit', 200);
    expect(error).not.toHaveBeenCalled();
  });
});
