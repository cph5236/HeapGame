import { UPGRADE_DEFS } from '../data/upgradeDefs';

const SAVE_KEY = 'heap_save';

interface RawSave {
  balance:  number;
  upgrades: Record<string, number>; // upgradeId → current level
}

export interface PlayerConfig {
  maxAirJumps:     number;
  wallJump:        boolean;
  dash:            boolean;
  moneyMultiplier: number;
}

const DEFAULT: RawSave = { balance: 0, upgrades: {} };

function load(): RawSave {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) return { ...DEFAULT, ...JSON.parse(raw) };
  } catch { /* corrupted save — fall through to default */ }
  return { ...DEFAULT, upgrades: {} };
}

function persist(data: RawSave): void {
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

export function getPlayerConfig(): PlayerConfig {
  return {
    maxAirJumps:     1 + getUpgradeLevel('air_jump'),
    wallJump:        getUpgradeLevel('wall_jump') > 0,
    dash:            getUpgradeLevel('dash') > 0,
    moneyMultiplier: 1 + getUpgradeLevel('money_mult') * 0.1,
  };
}
