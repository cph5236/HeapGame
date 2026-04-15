import { UPGRADE_DEFS } from '../data/upgradeDefs';
import { ITEM_DEFS } from '../data/itemDefs';
import { MAX_WALKABLE_SLOPE_DEG, MOUNTAIN_CLIMBER_INCREMENT } from '../constants';

const SAVE_KEY = 'heap_save';

export interface PlacedItemSave {
  id:    string;
  x:     number;
  y:     number;
  meta?: Record<string, number>;
}

interface RawSave {
  balance:    number;
  upgrades:   Record<string, number>;
  inventory:  Record<string, number>;
  placed:     PlacedItemSave[];
  playerGuid: string;
  playerName: string;
  highScores: Record<string, number>;
}

let _cache: RawSave | null = null;

function generateDefaultName(): string {
  const n = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
  return `Trashbag#${n}`;
}

export interface PlayerConfig {
  maxAirJumps:         number;
  wallJump:            boolean;
  dash:                boolean;
  dive:                boolean;
  moneyMultiplier:     number;
  jumpBoost:           number;
  stompBonus:          number;
  peakMultiplier:      number;
  maxWalkableSlopeDeg: number;
}

const DEFAULT: RawSave = {
  balance:    0,
  upgrades:   {},
  inventory:  {},
  placed:     [],
  playerGuid: '',
  playerName: '',
  highScores: {},
};

function load(): RawSave {
  if (_cache) return _cache;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<RawSave>;
      const result: RawSave = {
        ...DEFAULT,
        ...parsed,
        inventory:  parsed.inventory  ?? {},
        placed:     parsed.placed     ?? [],
        highScores: parsed.highScores ?? {},
        playerGuid: parsed.playerGuid ?? crypto.randomUUID(),
        playerName: parsed.playerName ?? generateDefaultName(),
      };
      _cache = result;
      return result;
    }
  } catch { /* corrupted save — fall through to default */ }
  const fresh: RawSave = {
    ...DEFAULT,
    upgrades:   {},
    inventory:  {},
    placed:     [],
    highScores: {},
    playerGuid: crypto.randomUUID(),
    playerName: generateDefaultName(),
  };
  _cache = fresh;
  return fresh;
}

function persist(data: RawSave): void {
  _cache = data;
  localStorage.setItem(SAVE_KEY, JSON.stringify(data));
}

// ── Balance ───────────────────────────────────────────────────────────────────

export function getBalance(): number {
  return load().balance;
}

export function addBalance(amount: number): void {
  const data = load();
  data.balance = Math.max(0, data.balance + amount);
  persist(data);
}

// ── Upgrades ──────────────────────────────────────────────────────────────────

export function getUpgradeLevel(id: string): number {
  return load().upgrades[id] ?? 0;
}

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

// ── Inventory ─────────────────────────────────────────────────────────────────

export function getItemQuantity(id: string): number {
  return load().inventory[id] ?? 0;
}

export function addItem(id: string, qty = 1): void {
  const data = load();
  data.inventory[id] = (data.inventory[id] ?? 0) + qty;
  persist(data);
}

export function spendItem(id: string): boolean {
  const data = load();
  const qty = data.inventory[id] ?? 0;
  if (qty <= 0) return false;
  data.inventory[id] = qty - 1;
  persist(data);
  return true;
}

export function purchaseItem(id: string): boolean {
  const def = ITEM_DEFS.find(d => d.id === id);
  if (!def) return false;
  const data = load();
  if (data.balance < def.cost) return false;
  data.balance -= def.cost;
  data.inventory[id] = (data.inventory[id] ?? 0) + 1;
  persist(data);
  return true;
}

// ── Placed items ──────────────────────────────────────────────────────────────

export function getPlaced(): PlacedItemSave[] {
  return [...load().placed];
}

export function addPlaced(item: PlacedItemSave): void {
  const data = load();
  data.placed.push(item);
  persist(data);
}

export function removePlaced(index: number): void {
  const data = load();
  data.placed.splice(index, 1);
  persist(data);
}

export function updatePlacedMeta(index: number, meta: Record<string, number>): void {
  const data = load();
  if (data.placed[index]) {
    data.placed[index].meta = meta;
    persist(data);
  }
}

export function removeExpiredPlaced(): void {
  const data = load();
  data.placed = data.placed.filter(p => {
    if (p.meta?.spawnsLeft !== undefined) return p.meta.spawnsLeft > 0;
    return true;
  });
  persist(data);
}

// ── Reset ─────────────────────────────────────────────────────────────────────

export function resetAllData(): void {
  _cache = null;
  localStorage.removeItem(SAVE_KEY);
}

// ── Player config ─────────────────────────────────────────────────────────────

export function getPlayerConfig(): PlayerConfig {
  const jl = getUpgradeLevel('jump_boost');
  const sl = getUpgradeLevel('stomp_gold');
  const pl = getUpgradeLevel('peak_hunter');
  return {
    maxAirJumps:         1 + getUpgradeLevel('air_jump'),
    wallJump:            getUpgradeLevel('wall_jump') > 0,
    dash:                getUpgradeLevel('dash') > 0,
    dive:                getUpgradeLevel('dive') > 0,
    moneyMultiplier:     1 + getUpgradeLevel('money_mult') * 0.1,
    jumpBoost:           [0, 70, 150, 240][jl],
    stompBonus:          [25, 50, 90, 150][sl],
    peakMultiplier:      [1.25, 1.40, 1.60, 1.85][pl],
    maxWalkableSlopeDeg: MAX_WALKABLE_SLOPE_DEG + getUpgradeLevel('mountain_climber') * MOUNTAIN_CLIMBER_INCREMENT,
  };
}

// ── Player identity ───────────────────────────────────────────────────────────

export function getPlayerGuid(): string {
  return load().playerGuid;
}

export function getPlayerName(): string {
  return load().playerName;
}

export function setPlayerName(name: string): void {
  const trimmed = name.trim().slice(0, 20);
  if (!trimmed) return;
  const data = load();
  data.playerName = trimmed;
  persist(data);
}

// ── High scores ───────────────────────────────────────────────────────────────

export function getLocalHighScore(heapId: string): number {
  return load().highScores[heapId] ?? 0;
}

export function setLocalHighScore(heapId: string, score: number): void {
  const data = load();
  data.highScores[heapId] = score;
  persist(data);
}
