import { UPGRADE_DEFS } from '../data/upgradeDefs';
import { ITEM_DEFS } from '../data/itemDefs';
import { MAX_WALKABLE_SLOPE_DEG, MOUNTAIN_CLIMBER_INCREMENT } from '../constants';

const SAVE_KEY = 'heap_save';
const CURRENT_SCHEMA = 2;

export interface PlacedItemSave {
  id:    string;
  x:     number;
  y:     number;
  meta?: Record<string, number>;
}

interface RawSave {
  schemaVersion: number;
  balance:        number;
  upgrades:       Record<string, number>;
  inventory:      Record<string, number>;
  placed:         Record<string, PlacedItemSave[]>;
  selectedHeapId: string;
  playerGuid:     string;
  playerName:     string;
  highScores:     Record<string, number>;
  _legacyPlaced?: PlacedItemSave[];
}

let _cache: RawSave | null = null;

function generateDefaultName(): string {
  const n = Array.from({ length: 5 }, () => Math.floor(Math.random() * 10)).join('');
  return `Trashbag#${n}`;
}

function freshSave(): RawSave {
  return {
    schemaVersion: CURRENT_SCHEMA,
    balance:        0,
    upgrades:       {},
    inventory:      {},
    placed:         {},
    selectedHeapId: '',
    playerGuid:     crypto.randomUUID(),
    playerName:     generateDefaultName(),
    highScores:     {},
  };
}

function migrate(parsed: any): RawSave {
  // v1 has no schemaVersion and `placed` is an array.
  const version = parsed?.schemaVersion ?? 1;
  if (version === CURRENT_SCHEMA && !Array.isArray(parsed.placed)) {
    return {
      schemaVersion: CURRENT_SCHEMA,
      balance:        parsed.balance        ?? 0,
      upgrades:       parsed.upgrades       ?? {},
      inventory:      parsed.inventory      ?? {},
      placed:         parsed.placed         ?? {},
      selectedHeapId: parsed.selectedHeapId ?? '',
      playerGuid:     parsed.playerGuid     ?? crypto.randomUUID(),
      playerName:     parsed.playerName     ?? generateDefaultName(),
      highScores:     parsed.highScores     ?? {},
      _legacyPlaced:  parsed._legacyPlaced,
    };
  }

  // v1 migration.
  const legacyArray: PlacedItemSave[] = Array.isArray(parsed?.placed) ? parsed.placed : [];
  return {
    schemaVersion: CURRENT_SCHEMA,
    balance:        parsed.balance    ?? 0,
    upgrades:       parsed.upgrades   ?? {},
    inventory:      parsed.inventory  ?? {},
    placed:         {},
    selectedHeapId: '',
    playerGuid:     parsed.playerGuid ?? crypto.randomUUID(),
    playerName:     parsed.playerName ?? generateDefaultName(),
    highScores:     parsed.highScores ?? {},
    _legacyPlaced:  legacyArray.length > 0 ? legacyArray : undefined,
  };
}

function load(): RawSave {
  if (_cache) return _cache;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const migrated = migrate(parsed);
      _cache = migrated;
      if ((parsed?.schemaVersion ?? 1) !== CURRENT_SCHEMA) persist(migrated);
      return migrated;
    }
  } catch { /* fall through */ }
  const fresh = freshSave();
  _cache = fresh;
  return fresh;
}

function persist(data: RawSave): void {
  _cache = data;
  localStorage.setItem(SAVE_KEY, JSON.stringify(data));
}

// ── Balance ───────────────────────────────────────────────────────────────────

export function getBalance(): number { return load().balance; }

export function addBalance(amount: number): void {
  const data = load();
  data.balance = Math.max(0, data.balance + amount);
  persist(data);
}

// ── Upgrades ──────────────────────────────────────────────────────────────────

export function getUpgradeLevel(id: string): number { return load().upgrades[id] ?? 0; }

export function purchaseUpgrade(id: string): boolean {
  const def = UPGRADE_DEFS.find(d => d.id === id);
  if (!def) return false;
  const data = load();
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

export function getItemQuantity(id: string): number { return load().inventory[id] ?? 0; }

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

// ── Placed items (per heap) ──────────────────────────────────────────────────

export function getPlaced(heapId: string): PlacedItemSave[] {
  return [...(load().placed[heapId] ?? [])];
}

export function addPlaced(heapId: string, item: PlacedItemSave): void {
  const data = load();
  if (!data.placed[heapId]) data.placed[heapId] = [];
  data.placed[heapId].push(item);
  persist(data);
}

export function removePlaced(heapId: string, index: number): void {
  const data = load();
  const list = data.placed[heapId];
  if (!list) return;
  list.splice(index, 1);
  persist(data);
}

export function updatePlacedMeta(heapId: string, index: number, meta: Record<string, number>): void {
  const data = load();
  const list = data.placed[heapId];
  if (!list || !list[index]) return;
  list[index].meta = meta;
  persist(data);
}

export function removeExpiredPlaced(heapId: string): void {
  const data = load();
  const list = data.placed[heapId];
  if (!list) return;
  data.placed[heapId] = list.filter(p => {
    if (p.meta?.spawnsLeft !== undefined) return p.meta.spawnsLeft > 0;
    return true;
  });
  persist(data);
}

// ── Legacy migration handoff ─────────────────────────────────────────────────

export function finalizeLegacyPlaced(heapId: string): void {
  const data = load();
  if (!data._legacyPlaced || data._legacyPlaced.length === 0) {
    if (data._legacyPlaced) {
      delete data._legacyPlaced;
      persist(data);
    }
    return;
  }
  const existing = data.placed[heapId] ?? [];
  data.placed[heapId] = [...existing, ...data._legacyPlaced];
  delete data._legacyPlaced;
  persist(data);
}

// ── Reset ─────────────────────────────────────────────────────────────────────

export function resetAllData(): void {
  _cache = null;
  localStorage.removeItem(SAVE_KEY);
}

// ── Player config ─────────────────────────────────────────────────────────────

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

export function getPlayerGuid(): string { return load().playerGuid; }
export function getPlayerName(): string { return load().playerName; }

export function setPlayerName(name: string): void {
  const trimmed = name.trim().slice(0, 20);
  if (!trimmed) return;
  const data = load();
  data.playerName = trimmed;
  persist(data);
}

// ── Selected heap ────────────────────────────────────────────────────────────

export function getSelectedHeapId(): string { return load().selectedHeapId; }

export function setSelectedHeapId(id: string): void {
  const data = load();
  data.selectedHeapId = id;
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

// ── Test helpers ──────────────────────────────────────────────────────────────

export function resetCacheForTests(): void { _cache = null; }
export function getLegacyPlacedForTests(): PlacedItemSave[] | undefined { return load()._legacyPlaced; }
export function getSchemaVersionForTests(): number { return load().schemaVersion; }
