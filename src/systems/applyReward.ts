// src/systems/applyReward.ts

import { addBalance, addItem } from './SaveData';
import { ITEM_DEFS } from '../data/itemDefs';
import type { RewardPayload } from '../../shared/codeTypes';

export interface AppliedReward { ok: boolean; message: string }

/** Apply a server-granted reward to local SaveData. Shared by reward-code
 *  redemption and Daily Drop claims — one grant path, one item-id guard. */
export function applyReward(reward: RewardPayload): AppliedReward {
  if (reward.rewardType === 'coins') {
    addBalance(reward.rewardAmount);
    return { ok: true, message: `+${reward.rewardAmount} coins` };
  }
  const def = ITEM_DEFS.find((d) => d.id === reward.rewardId);
  if (!def) return { ok: false, message: 'Unknown reward item' };
  addItem(def.id, reward.rewardAmount);
  return { ok: true, message: `+${reward.rewardAmount} ${def.name}` };
}
