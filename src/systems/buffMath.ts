import type { PickupEffect } from '../data/pickupDefs';

export interface BuffAggregate {
  speedMult: number;
  jumpBonus: number;
  extraAirJumps: number;
  gravityMult: number;
  cooldownMult: number;
  wallSpeedMult: number;
}

export interface ActiveBuff {
  id: string;
  effect: Partial<PickupEffect>;
  remainingMs: number; // Infinity for whole-run
  durationMs: number;  // Infinity for whole-run; used for the HUD ratio
}

const IDENTITY: BuffAggregate = {
  speedMult: 1, jumpBonus: 0, extraAirJumps: 0,
  gravityMult: 1, cooldownMult: 1, wallSpeedMult: 1,
};

/** Fold buff effects into one set: mults multiply, jump/air-jumps add. */
export function aggregateBuffEffects(effects: Partial<PickupEffect>[]): BuffAggregate {
  return effects.reduce<BuffAggregate>((acc, e) => ({
    speedMult:     acc.speedMult     * (e.speedMult     ?? 1),
    jumpBonus:     acc.jumpBonus     + (e.jumpBonus     ?? 0),
    extraAirJumps: acc.extraAirJumps + (e.extraAirJumps ?? 0),
    gravityMult:   acc.gravityMult   * (e.gravityMult   ?? 1),
    cooldownMult:  acc.cooldownMult  * (e.cooldownMult  ?? 1),
    wallSpeedMult: acc.wallSpeedMult * (e.wallSpeedMult ?? 1),
  }), { ...IDENTITY });
}

/** Add a buff, or refresh an existing one with the same id (no duplicates). */
export function upsertBuff(active: ActiveBuff[], buff: ActiveBuff): ActiveBuff[] {
  const idx = active.findIndex(b => b.id === buff.id);
  if (idx === -1) return [...active, buff];
  const copy = active.slice();
  copy[idx] = buff;
  return copy;
}

/** Decrement timers and drop expired buffs. `changed` is true if any were dropped. */
export function tickBuffs(active: ActiveBuff[], deltaMs: number): { active: ActiveBuff[]; changed: boolean } {
  let changed = false;
  const next: ActiveBuff[] = [];
  for (const b of active) {
    if (b.remainingMs === Infinity) { next.push(b); continue; }
    const remainingMs = b.remainingMs - deltaMs;
    if (remainingMs <= 0) { changed = true; continue; }
    next.push({ ...b, remainingMs });
  }
  return { active: next, changed };
}
