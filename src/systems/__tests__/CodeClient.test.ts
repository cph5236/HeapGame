import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock SaveData and fetchWithLog before importing the module under test.
const addBalance = vi.fn();
const addItem = vi.fn();
vi.mock('../SaveData', () => ({
  getPlayerGuid: () => 'guid-test',
  getEffectivePlayerId: () => 'gpgs-effective',
  addBalance: (n: number) => addBalance(n),
  addItem: (id: string, qty: number) => addItem(id, qty),
}));
const fetchWithLog = vi.fn();
vi.mock('../../logging/fetchWithLog', () => ({
  fetchWithLog: (...args: unknown[]) => fetchWithLog(...args),
}));

import { redeemCode } from '../CodeClient';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('redeemCode', () => {
  beforeEach(() => { addBalance.mockClear(); addItem.mockClear(); fetchWithLog.mockReset(); });

  it('applies coins and reports success', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(200, { rewardType: 'coins', rewardAmount: 500 }));
    const result = await redeemCode('welcome');
    expect(result.status).toBe('success');
    expect(addBalance).toHaveBeenCalledWith(500);
    expect(result.message).toContain('500');
  });

  it('redeems under the effective player id (GPGS id when signed in), not the local GUID', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(200, { rewardType: 'coins', rewardAmount: 100 }));
    await redeemCode('welcome');
    const init = fetchWithLog.mock.calls[0][1] as { body: string };
    expect(JSON.parse(init.body).playerGuid).toBe('gpgs-effective');
  });

  it('applies a known item and reports success', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(200, { rewardType: 'item', rewardId: 'shield', rewardAmount: 2 }));
    const result = await redeemCode('SHIELD2');
    expect(result.status).toBe('success');
    expect(addItem).toHaveBeenCalledWith('shield', 2);
  });

  it('does not grant an unknown item id', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(200, { rewardType: 'item', rewardId: 'ghost_item', rewardAmount: 1 }));
    const result = await redeemCode('BAD');
    expect(result.status).toBe('error');
    expect(addItem).not.toHaveBeenCalled();
  });

  it('maps 404 → notFound', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(404, { error: 'code not found' }));
    expect((await redeemCode('X')).status).toBe('notFound');
  });

  it('maps 410 → expired', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(410, { error: 'code expired' }));
    expect((await redeemCode('X')).status).toBe('expired');
  });

  it('maps 409 already-redeemed → already', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(409, { error: 'already redeemed' }));
    expect((await redeemCode('X')).status).toBe('already');
  });

  it('maps 409 exhausted → exhausted', async () => {
    fetchWithLog.mockResolvedValue(jsonResponse(409, { error: 'code fully redeemed' }));
    expect((await redeemCode('X')).status).toBe('exhausted');
  });

  it('maps a network throw → offline', async () => {
    fetchWithLog.mockRejectedValue(new Error('network down'));
    expect((await redeemCode('X')).status).toBe('offline');
  });

  it('rejects an empty code without calling the network', async () => {
    expect((await redeemCode('   ')).status).toBe('error');
    expect(fetchWithLog).not.toHaveBeenCalled();
  });
});
