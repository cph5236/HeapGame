import { UPGRADE_DEFS } from '../data/upgradeDefs';
import { MAX_WALKABLE_SLOPE_DEG, MOUNTAIN_CLIMBER_INCREMENT } from '../constants';

const SAVE_KEY = 'heap_save';

interface RawSave {
  balance:  number;
  upgrades: Record<string, number>; // upgradeId → current level
}

let _cache: RawSave | null = null;

export interface PlayerConfig {
  maxAirJumps:         number;
  wallJump:            boolean;
  dash:                boolean;
  dive:                boolean;
  moneyMultiplier:     number;
  jumpBoost:           number; // px/s added to jump magnitude (0, 70, 150, 240)
  stompBonus:          number; // coins per enemy stomp (25, 50, 90, 150)
  peakMultiplier:      number; // peak coin multiplier (1.25, 1.40, 1.60, 1.85)
  maxWalkableSlopeDeg: number;
}

const DEFAULT: RawSave = { balance: 0, upgrades: {} };

function load(): RawSave {
  if (_cache) return _cache;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const parsed: RawSave = { ...DEFAULT, ...JSON.parse(raw) };
      _cache = parsed;
      return parsed;
    }
  } catch { /* corrupted save — fall through to default */ }
  const fresh: RawSave = { ...DEFAULT, upgrades: {} };
  _cache = fresh;
  return fresh;
}

function persist(data: RawSave): void {
  _cache = data;
  localStorage.setItem(SAVE_KEY, JSON.stringify(data));
}

export function getBalance(): number {
  return load().balance;
}

export function addBalance(amount: number): void {
  const data = load();
  data.balance = Math.max(0, data.balance + amount);
  persist(data);
}

export function getUpgradeLevel(id: string): number {
  return load().upgrades[id] ?? 0;
}

/**
 * Attempt to purchase the next level of an upgrade.
 * Returns true on success, false if maxed or insufficient balance.
 */
export function purchaseUpgrade(id: string): boolean {
  const def = UPGRADE_DEFS.find(d => d.id === id);
  if (!def) return false;

  const data  = load();
  const level = data.upgrades[id] ?? 0;
  if (level >= def.maxLevel) return false;

  const price = def.cost(level + 1);
  if (data.balance < price) return false;

  data.balance -= price;
  data.upgrades[id] = level + 1;
  persist(data);
  return true;
}

/** Wipe all saved progress — balance, upgrades. */
export function resetAllData(): void {
  _cache = null;
  localStorage.removeItem(SAVE_KEY);
}

export function getPlayerConfig(): PlayerConfig {
  const jl = getUpgradeLevel('jump_boost');
  const sl = getUpgradeLevel('stomp_gold');
  const pl = getUpgradeLevel('peak_hunter');
  return {
    maxAirJumps:     1 + getUpgradeLevel('air_jump'),
    wallJump:        getUpgradeLevel('wall_jump') > 0,
    dash:            getUpgradeLevel('dash') > 0,
    dive:            getUpgradeLevel('dive') > 0,
    moneyMultiplier: 1 + getUpgradeLevel('money_mult') * 0.1,
    jumpBoost:       [0, 70, 150, 240][jl],
    stompBonus:      [25, 50, 90, 150][sl],
    peakMultiplier:      [1.25, 1.40, 1.60, 1.85][pl],
    maxWalkableSlopeDeg: MAX_WALKABLE_SLOPE_DEG + getUpgradeLevel('mountain_climber') * MOUNTAIN_CLIMBER_INCREMENT,
  };
}
