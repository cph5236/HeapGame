import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

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

// Stub localStorage — the status cache lives there, and vitest runs in node
beforeAll(() => {
  const store = new Map<string, string>();
  Object.defineProperty(global, 'localStorage', {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store.clear(); },
    },
    configurable: true,
  });
});

const HOUR = 3_600_000;

beforeEach(() => {
  addBalance.mockClear(); addItem.mockClear(); fetchWithLog.mockReset(); localStorage.clear();
});

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

  it('serves a claimed-today snapshot from cache without hitting the network again', async () => {
    const status = {
      streakDay: 2, claimedToday: true, nextClaimDay: 3, todayGrants: [],
      nextEligibleAt: Date.now() + HOUR,
      stableUntil: Date.now() + HOUR,
    };
    fetchWithLog.mockResolvedValue(jsonResponse(200, status));

    const first = await fetchDailyStatus();
    expect(first).toEqual({ status: 'ok', data: status });
    expect(fetchWithLog).toHaveBeenCalledTimes(1);

    const second = await fetchDailyStatus();
    expect(second).toEqual({ status: 'ok', data: status });
    expect(fetchWithLog).toHaveBeenCalledTimes(1); // no second call
  });

  it('caches an unclaimed snapshot too — locked/ready is decided locally', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(200, {
      streakDay: 2, claimedToday: false, nextClaimDay: 3, todayGrants: [],
      nextEligibleAt: Date.now() - HOUR,
      stableUntil: Date.now() + 12 * HOUR,
    }));
    await fetchDailyStatus();
    await fetchDailyStatus();
    expect(fetchWithLog).toHaveBeenCalledTimes(1);
  });

  it('keeps fetching against a server that omits stableUntil', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(200, {
      streakDay: 2, claimedToday: true, nextClaimDay: 3, todayGrants: [],
      nextEligibleAt: Date.now() + HOUR,
    }));
    await fetchDailyStatus();
    await fetchDailyStatus();
    expect(fetchWithLog).toHaveBeenCalledTimes(2);
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

  it('seeds the status cache so the next menu load skips /daily/status', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(200, {
      kind: 'ok', streakDay: 3, rewards: [{ rewardType: 'coins', rewardAmount: 100 }],
      nextRewardPreview: [{ type: 'coins', amount: 150 }],
      nextEligibleAt: Date.now() + HOUR,
      stableUntil: Date.now() + HOUR,
    }));
    await claimDaily();
    fetchWithLog.mockClear();

    const out = await fetchDailyStatus();
    expect(fetchWithLog).not.toHaveBeenCalled();
    expect(out).toMatchObject({
      status: 'ok',
      data: { streakDay: 3, claimedToday: true, nextClaimDay: 4, todayGrants: [{ type: 'coins', amount: 150 }] },
    });
  });

  it('does not cache a claim from a server that omits stableUntil', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(200, {
      kind: 'ok', streakDay: 3, rewards: [], nextRewardPreview: [],
    }));
    await claimDaily();
    fetchWithLog.mockResolvedValue(jsonResponse(200, {
      streakDay: 3, claimedToday: true, nextClaimDay: 4, todayGrants: [],
    }));
    fetchWithLog.mockClear();

    await fetchDailyStatus();
    expect(fetchWithLog).toHaveBeenCalledTimes(1);
  });

  it('drops a cached snapshot when a claim comes back 409', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(200, {
      streakDay: 2, claimedToday: true, nextClaimDay: 3, todayGrants: [],
      nextEligibleAt: Date.now() + HOUR,
      stableUntil: Date.now() + HOUR,
    }));
    await fetchDailyStatus();

    fetchWithLog.mockResolvedValue(jsonResponse(409, { kind: 'notEligible', nextEligibleAt: 1 }));
    await claimDaily();

    fetchWithLog.mockResolvedValue(jsonResponse(200, {
      streakDay: 2, claimedToday: true, nextClaimDay: 3, todayGrants: [],
    }));
    fetchWithLog.mockClear();
    await fetchDailyStatus();
    expect(fetchWithLog).toHaveBeenCalledTimes(1);
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
