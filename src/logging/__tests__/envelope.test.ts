// src/logging/__tests__/envelope.test.ts
//
// The envelope's id must match what player_auth keys on, or no event can be
// joined to a new-player cohort. See PR #93 for the same trap in another guise.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../systems/SaveData', () => ({
  getPlayerGuid: vi.fn(() => 'guid-aaaa'),
  getEffectivePlayerId: vi.fn(() => 'guid-aaaa'),
  getVerboseLogging: vi.fn(() => true),
}));

import { getLogEnvelope } from '../index';
import { getEffectivePlayerId, getPlayerGuid } from '../../systems/SaveData';

describe('log envelope identity', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('stamps the effective player id, not the raw guid', () => {
    vi.mocked(getPlayerGuid).mockReturnValue('guid-aaaa');
    vi.mocked(getEffectivePlayerId).mockReturnValue('gpgs-1234567890');
    expect(getLogEnvelope().userGuid).toBe('gpgs-1234567890');
  });

  it('falls back to the guid when no GPGS id is set (they are equal)', () => {
    vi.mocked(getEffectivePlayerId).mockReturnValue('guid-aaaa');
    expect(getLogEnvelope().userGuid).toBe('guid-aaaa');
  });

  it("uses 'pre-init' when SaveData is not ready", () => {
    vi.mocked(getEffectivePlayerId).mockImplementation(() => { throw new Error('not ready'); });
    expect(getLogEnvelope().userGuid).toBe('pre-init');
  });
});
