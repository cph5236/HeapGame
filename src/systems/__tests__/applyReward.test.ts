import { describe, it, expect, vi, beforeEach } from 'vitest';

const addBalance = vi.fn();
const addItem = vi.fn();
vi.mock('../SaveData', () => ({
  addBalance: (n: number) => addBalance(n),
  addItem: (id: string, qty: number) => addItem(id, qty),
}));

import { applyReward } from '../applyReward';

describe('applyReward', () => {
  beforeEach(() => { addBalance.mockClear(); addItem.mockClear(); });

  it('applies coins', () => {
    const out = applyReward({ rewardType: 'coins', rewardAmount: 500 });
    expect(out.ok).toBe(true);
    expect(out.message).toBe('+500 coins');
    expect(addBalance).toHaveBeenCalledWith(500);
  });

  it('applies a known item using its display name', () => {
    const out = applyReward({ rewardType: 'item', rewardId: 'shield', rewardAmount: 2 });
    expect(out.ok).toBe(true);
    expect(out.message).toContain('+2');
    expect(addItem).toHaveBeenCalledWith('shield', 2);
  });

  it('rejects an unknown item id without granting', () => {
    const out = applyReward({ rewardType: 'item', rewardId: 'ghost', rewardAmount: 1 });
    expect(out.ok).toBe(false);
    expect(addItem).not.toHaveBeenCalled();
  });
});
