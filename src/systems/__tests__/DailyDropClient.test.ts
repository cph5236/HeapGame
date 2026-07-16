import { describe, it, expect, vi, beforeEach } from 'vitest';

const addBalance = vi.fn();
const addItem = vi.fn();
vi.mock('../SaveData', () => ({
  getEffectivePlayerId: () => 'gpgs-effective',
  addBalance: (n: number) => addBalance(n),
  addItem: (id: string, qty: number) => addItem(id, qty),
}));
const fetchWithLog = vi.fn();
vi.mock('../../logging/fetchWithLog', () => ({
  fetchWithLog: (...args: unknown[]) => fetchWithLog(...args),
}));
vi.mock('../authToken', () => ({
  authHeaders: () => ({ 'X-Player-Token': 'secret-test' }),
  logIfAuthRejected: vi.fn(),
}));

import { fetchDailyStatus, claimDaily } from '../DailyDropClient';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => { addBalance.mockClear(); addItem.mockClear(); fetchWithLog.mockReset(); });

describe('fetchDailyStatus', () => {
  it('returns parsed status and sends the effective player id + offset', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(200, {
      streakDay: 2, claimedToday: false, nextClaimDay: 3, todayGrants: [],
    }));
    const out = await fetchDailyStatus();
    expect(out.status).toBe('ok');
    const url = fetchWithLog.mock.calls[0][0] as string;
    expect(url).toContain('playerGuid=gpgs-effective');
    expect(url).toContain('utcOffsetMin=');
  });

  it('maps fetch failure to offline', async () => {
    fetchWithLog.mockRejectedValue(new Error('net'));
    expect((await fetchDailyStatus()).status).toBe('offline');
  });

  it('maps non-200 to offline', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(500, {}));
    expect((await fetchDailyStatus()).status).toBe('offline');
  });
});

describe('claimDaily', () => {
  it('applies every reward in the array and reports messages', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(200, {
      kind: 'ok', streakDay: 7,
      rewards: [
        { rewardType: 'coins', rewardAmount: 300 },
        { rewardType: 'item', rewardId: 'revive', rewardAmount: 1 },
      ],
      nextRewardPreview: [],
    }));
    const out = await claimDaily();
    expect(out).toMatchObject({ status: 'claimed', streakDay: 7 });
    expect(addBalance).toHaveBeenCalledWith(300);
    expect(addItem).toHaveBeenCalledWith('revive', 1);
    if (out.status === 'claimed') expect(out.messages).toHaveLength(2);
  });

  it('passes resolution through in the body', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(200, {
      kind: 'ok', streakDay: 5, rewards: [{ rewardType: 'coins', rewardAmount: 1 }], nextRewardPreview: [],
    }));
    await claimDaily('repair');
    const init = fetchWithLog.mock.calls[0][1] as { body: string };
    expect(JSON.parse(init.body).resolution).toBe('repair');
  });

  it('maps streakBroken through without granting', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(200, { kind: 'streakBroken', repairableDay: 4 }));
    const out = await claimDaily();
    expect(out).toEqual({ status: 'streakBroken', repairableDay: 4 });
    expect(addBalance).not.toHaveBeenCalled();
  });

  it('maps 409 to notEligible', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(409, { kind: 'notEligible', nextEligibleAt: 1 }));
    expect((await claimDaily()).status).toBe('notEligible');
  });

  it('maps network failure to offline', async () => {
    fetchWithLog.mockRejectedValue(new Error('net'));
    expect((await claimDaily()).status).toBe('offline');
  });

  it('sends the auth token header', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(200, {
      kind: 'ok', streakDay: 1, rewards: [], nextRewardPreview: [],
    }));
    await claimDaily();
    const init = fetchWithLog.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers['X-Player-Token']).toBe('secret-test');
  });
});
