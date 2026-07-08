// src/systems/CodeClient.ts

import { getEffectivePlayerId, addBalance, addItem } from './SaveData';
import { fetchWithLog } from '../logging/fetchWithLog';
import { ITEM_DEFS } from '../data/itemDefs';
import type { RewardPayload, RedeemCodeRequest } from '../../shared/codeTypes';
import { authHeaders, logIfAuthRejected } from './authToken';

const SERVER_URL: string =
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_HEAP_SERVER_URL ??
  'http://localhost:8787';

export type RedeemStatus =
  | 'success' | 'already' | 'expired' | 'exhausted' | 'notFound' | 'offline' | 'error';

export interface RedeemResult {
  status:  RedeemStatus;
  message: string;
  reward?: RewardPayload;
}

/** Validates + redeems a code server-side, then applies the reward to SaveData. */
export async function redeemCode(rawCode: string): Promise<RedeemResult> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return { status: 'error', message: 'Enter a code' };

  const req: RedeemCodeRequest = { code, playerGuid: getEffectivePlayerId() };
  let res: Response;
  try {
    res = await fetchWithLog(`${SERVER_URL}/codes/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(req),
    });
  } catch {
    return { status: 'offline', message: 'Offline — try again' };
  }

  if (res.ok) {
    const reward = (await res.json()) as RewardPayload;
    return applyReward(reward);
  }

  logIfAuthRejected('codes:redeem', res.status);

  switch (res.status) {
    case 404: return { status: 'notFound', message: 'Code not found' };
    case 410: return { status: 'expired',  message: 'Code expired' };
    case 409: {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return body.error === 'already redeemed'
        ? { status: 'already',   message: 'Already redeemed' }
        : { status: 'exhausted', message: 'Code fully redeemed' };
    }
    default:  return { status: 'error', message: 'Could not redeem' };
  }
}

function applyReward(reward: RewardPayload): RedeemResult {
  if (reward.rewardType === 'coins') {
    addBalance(reward.rewardAmount);
    return { status: 'success', message: `✓ +${reward.rewardAmount} coins`, reward };
  }
  const def = ITEM_DEFS.find(d => d.id === reward.rewardId);
  if (!def) {
    return { status: 'error', message: 'Unknown reward item' };
  }
  addItem(def.id, reward.rewardAmount);
  return { status: 'success', message: `✓ +${reward.rewardAmount} ${def.name}`, reward };
}
