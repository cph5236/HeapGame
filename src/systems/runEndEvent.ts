// src/systems/runEndEvent.ts
//
// The single `run:end` emit site. It used to be four copy-pasted blocks across
// GameScene (3) and InfiniteGameScene (1), each re-deriving the kill total by
// hand — so any new field had to be added in four places, and a dataset missing
// one of them looks complete until you go looking for the gap.

import { getLogger } from '../logging';
import { getUpgrades } from './SaveData';
import type { GameMode, RunEndCause } from '../../shared/logging/events';

export interface RunEndFacts {
  heapId: string;
  mode: GameMode;
  cause: RunEndCause;
  score: number;
  height: number;
  durationMs: number;
  /** Per-enemy-type kill counts; summed here so callers never do it themselves. */
  kills: Record<string, number>;
  pickups: Record<string, number>;
  pickupBonus: number;
}

export function emitRunEnd(facts: RunEndFacts): void {
  const killCount = Object.values(facts.kills).reduce((sum, v) => sum + v, 0);
  getLogger().event({
    type: 'run:end',
    heapId: facts.heapId,
    mode: facts.mode,
    score: facts.score,
    height: facts.height,
    kills: killCount,
    durationMs: facts.durationMs,
    cause: facts.cause,
    upgrades: getUpgrades(),
    pickups: facts.pickups,
    pickupBonus: facts.pickupBonus,
  });
}
