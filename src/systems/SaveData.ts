import { UPGRADE_DEFS } from '../data/upgradeDefs';
import { ITEM_DEFS } from '../data/itemDefs';
import { getCosmeticDef } from '../data/cosmeticDefs';
import { clampHatAdjustment, type HatAdjustment, type HatAdjustments } from './cosmeticsLogic';
import type { EquippedLoadout, CosmeticSlot } from '../../shared/cosmeticCatalog';
import { generateDefaultPlayerName, MAX_PLAYER_NAME_LEN } from '../../shared/playerName';
import { MAX_WALKABLE_SLOPE_DEG, MOUNTAIN_CLIMBER_INCREMENT, MONEY_MULT_PER_LEVEL } from '../constants';

const SAVE_KEY = 'heap_save';
const CURRENT_SCHEMA = 5;

// World height at each schema version — used to remap placed item Y values.
const WORLD_HEIGHT_V2 = 50_000;
const WORLD_HEIGHT_V3 = 5_000_000;

export interface PlacedItemSave {
  id:    string;
  x:     number;
  y:     number;
  meta?: Record<string, number>;
}

export interface SoundSettings {
  master:    number;
  music:     number;
  playerSfx: number;
  enemySfx:  number;
  envSfx:    number;
}

const DEFAULT_SOUND_SETTINGS: SoundSettings = {
  master:    1.0,
  music:     0.7,
  playerSfx: 1.0,
  enemySfx:  0.8,
  envSfx:    0.9,
};

export type { RawSave };

interface RawSave {
  schemaVersion: number;
  balance:        number;
  upgrades:       Record<string, number>;
  inventory:      Record<string, number>;
  placed:         Record<string, PlacedItemSave[]>;
  selectedHeapId: string;
  playerGuid:     string;
  playerSecret?:  string;   // private write-auth token — never displayed, never logged
  playerName:     string;
  gpgsPlayerId?:  string;
  highScores:     Record<string, number>;
  cosmeticsOwned:      string[];
  cosmeticsEquipped:   EquippedLoadout;
  loadoutSyncPending?: boolean;
  hatAdjustments?:     HatAdjustments;   // per-hat-id fit tweaks (dAngle/dScale)
  verboseLogging?: boolean;
  tutorialDone?:   boolean;
  customizeHintSeen?: boolean;  // has the player opened the customizer at least once?
  _legacyPlaced?: PlacedItemSave[];
  soundSettings?: SoundSettings;
  adRunsSinceLast?: number;
  adRunTarget?:     number;
  controlMode?:     'tilt' | 'joystick';
  joystickSide?:    'left' | 'right';
}

let _cache: RawSave | null = null;

function generateGuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

function freshSave(): RawSave {
  return {
    schemaVersion: CURRENT_SCHEMA,
    balance:        0,
    upgrades:       {},
    inventory:      {},
    placed:         {},
    selectedHeapId: '',
    playerGuid:     generateGuid(),
    playerName:     generateDefaultPlayerName(),
    highScores:     {},
    cosmeticsOwned: [],
    cosmeticsEquipped: {},
    tutorialDone:   false,
    soundSettings:  { ...DEFAULT_SOUND_SETTINGS },
  };
}

function remapPlacedY(placed: Record<string, PlacedItemSave[]>, oldHeight: number, newHeight: number): Record<string, PlacedItemSave[]> {
  const result: Record<string, PlacedItemSave[]> = {};
  for (const [heapId, items] of Object.entries(placed)) {
    result[heapId] = items.map(item => ({
      ...item,
      y: newHeight - (oldHeight - item.y),
    }));
  }
  return result;
}

function migrate(parsed: any): RawSave {
  const version = parsed?.schemaVersion ?? 1;

  if (version === CURRENT_SCHEMA) {
    return {
      schemaVersion:  CURRENT_SCHEMA,
      balance:        parsed.balance        ?? 0,
      upgrades:       parsed.upgrades       ?? {},
      inventory:      parsed.inventory      ?? {},
      placed:         parsed.placed         ?? {},
      selectedHeapId: parsed.selectedHeapId ?? '',
      playerGuid:     parsed.playerGuid     ?? generateGuid(),
      playerSecret:   parsed.playerSecret,
      playerName:     parsed.playerName     ?? generateDefaultPlayerName(),
      gpgsPlayerId:   parsed.gpgsPlayerId,
      highScores:     parsed.highScores     ?? {},
      cosmeticsOwned: parsed.cosmeticsOwned ?? [],
      cosmeticsEquipped: parsed.cosmeticsEquipped ?? {},
      loadoutSyncPending: parsed.loadoutSyncPending,
      hatAdjustments: parsed.hatAdjustments,
      tutorialDone:   parsed.tutorialDone   ?? true,
      customizeHintSeen: parsed.customizeHintSeen,
      verboseLogging: parsed.verboseLogging,
      _legacyPlaced:  parsed._legacyPlaced,
      soundSettings:  parsed.soundSettings  ?? { ...DEFAULT_SOUND_SETTINGS },
      adRunsSinceLast: parsed.adRunsSinceLast,
      adRunTarget:     parsed.adRunTarget,
      controlMode:    parsed.controlMode,
      joystickSide:   parsed.joystickSide,
    };
  }

  // v1: `placed` is a flat array, no schemaVersion.
  if (version === 1) {
    const legacyArray: PlacedItemSave[] = Array.isArray(parsed?.placed) ? parsed.placed : [];
    return {
      schemaVersion: CURRENT_SCHEMA,
      balance:        parsed.balance    ?? 0,
      upgrades:       parsed.upgrades   ?? {},
      inventory:      parsed.inventory  ?? {},
      placed:         {},
      selectedHeapId: '',
      playerGuid:     parsed.playerGuid ?? generateGuid(),
      playerName:     parsed.playerName ?? generateDefaultPlayerName(),
      highScores:     parsed.highScores ?? {},
      cosmeticsOwned: [],
      cosmeticsEquipped: {},
      tutorialDone:   parsed.tutorialDone ?? true,
      verboseLogging: parsed.verboseLogging,
      soundSettings:  { ...DEFAULT_SOUND_SETTINGS },
      // v1 items have no world-height context — leave Y as-is; can't safely remap
      _legacyPlaced:  legacyArray.length > 0 ? legacyArray : undefined,
    };
  }

  // v4 → v5: identical layout, just add the cosmetics fields. Must NOT fall
  // through to the v2→v3 branch below, which remaps placed-item Y values.
  if (version === 4) {
    return {
      schemaVersion:  CURRENT_SCHEMA,
      balance:        parsed.balance        ?? 0,
      upgrades:       parsed.upgrades       ?? {},
      inventory:      parsed.inventory      ?? {},
      placed:         parsed.placed         ?? {},
      selectedHeapId: parsed.selectedHeapId ?? '',
      playerGuid:     parsed.playerGuid     ?? generateGuid(),
      playerName:     parsed.playerName     ?? generateDefaultPlayerName(),
      gpgsPlayerId:   parsed.gpgsPlayerId,
      highScores:     parsed.highScores     ?? {},
      cosmeticsOwned:    [],
      cosmeticsEquipped: {},
      tutorialDone:   parsed.tutorialDone   ?? true,
      verboseLogging: parsed.verboseLogging,
      _legacyPlaced:  parsed._legacyPlaced,
      soundSettings:  parsed.soundSettings  ?? { ...DEFAULT_SOUND_SETTINGS },
      adRunsSinceLast: parsed.adRunsSinceLast,
      adRunTarget:     parsed.adRunTarget,
      controlMode:    parsed.controlMode,
      joystickSide:   parsed.joystickSide,
    };
  }

  // v2 → v3: remap placed item Y values from 50 000-tall world to 5 000 000-tall world.
  const placed: Record<string, PlacedItemSave[]> = parsed.placed ?? {};
  return {
    schemaVersion: CURRENT_SCHEMA,
    balance:        parsed.balance        ?? 0,
    upgrades:       parsed.upgrades       ?? {},
    inventory:      parsed.inventory      ?? {},
    placed:         remapPlacedY(placed, WORLD_HEIGHT_V2, WORLD_HEIGHT_V3),
    selectedHeapId: parsed.selectedHeapId ?? '',
    playerGuid:     parsed.playerGuid     ?? generateGuid(),
    playerName:     parsed.playerName     ?? generateDefaultPlayerName(),
    gpgsPlayerId:   parsed.gpgsPlayerId,
    highScores:     parsed.highScores     ?? {},
    cosmeticsOwned: [],
    cosmeticsEquipped: {},
    tutorialDone:   parsed.tutorialDone   ?? true,
    verboseLogging: parsed.verboseLogging,
    soundSettings:  { ...DEFAULT_SOUND_SETTINGS },
    _legacyPlaced:  parsed._legacyPlaced,
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

// ── Ad-run pacing (device-local; not cloud-synced) ──────────────────────────────

export function getAdRunState(): { runsSinceLast: number; target: number } {
  const data = load();
  return { runsSinceLast: data.adRunsSinceLast ?? 0, target: data.adRunTarget ?? 0 };
}

export function setAdRunState(state: { runsSinceLast: number; target: number }): void {
  const data = load();
  data.adRunsSinceLast = state.runsSinceLast;
  data.adRunTarget     = state.target;
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

export function getUpgrades(): Record<string, number> { return { ...load().upgrades }; }

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
    moneyMultiplier:     1 + getUpgradeLevel('money_mult') * MONEY_MULT_PER_LEVEL,
    jumpBoost:           [0, 25, 35, 45, 55, 60, 65, 70, 75][jl],
    stompBonus:          [25, 40, 50, 60][sl],
    peakMultiplier:      [1.0, 1.25, 1.50, 1.75, 2.00][pl],
    maxWalkableSlopeDeg: MAX_WALKABLE_SLOPE_DEG + getUpgradeLevel('mountain_climber') * MOUNTAIN_CLIMBER_INCREMENT,
  };
}

// ── Player identity ───────────────────────────────────────────────────────────

export function getPlayerGuid(): string { return load().playerGuid; }
export function getPlayerName(): string { return load().playerName; }

export function setPlayerName(name: string): void {
  const trimmed = name.trim().slice(0, MAX_PLAYER_NAME_LEN);
  if (!trimmed) return;
  const data = load();
  data.playerName = trimmed;
  persist(data);
}

export function getGpgsPlayerId(): string | null { return load().gpgsPlayerId ?? null; }

/** The identity all server writes must key on: GPGS id when signed in, else the
 *  local GUID. Scores and cosmetics join on player_id server-side, so every
 *  per-player endpoint must use this — never getPlayerGuid directly. */
export function getEffectivePlayerId(): string { return getGpgsPlayerId() ?? getPlayerGuid(); }

export function setGpgsPlayerId(id: string): void {
  const data = load();
  data.gpgsPlayerId = id;
  persist(data);
}

/** Private write-auth secret, sent as X-Player-Token on server writes.
 *  Lazily backfilled for saves that predate it; rides in cloud saves. */
export function getPlayerSecret(): string {
  const s = load();
  if (!s.playerSecret) {
    s.playerSecret = generateGuid();
    persist(s);
  }
  return s.playerSecret;
}

// ── Verbose logging ───────────────────────────────────────────────────────────

export function getVerboseLogging(): boolean { return load().verboseLogging ?? false; }
export function setVerboseLogging(enabled: boolean): void {
  const data = load();
  data.verboseLogging = enabled;
  persist(data);
}

// ── Tutorial done flag ─────────────────────────────────────────────────────────

export function getTutorialDone(): boolean { return load().tutorialDone ?? false; }
export function setTutorialDone(value: boolean): void {
  const data = load();
  persist({ ...data, tutorialDone: value });
}

// ── Customizer hint seen flag ───────────────────────────────────────────────────

export function getCustomizeHintSeen(): boolean { return load().customizeHintSeen ?? false; }
export function setCustomizeHintSeen(value: boolean): void {
  const data = load();
  persist({ ...data, customizeHintSeen: value });
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

// ── Cosmetics ─────────────────────────────────────────────────────────────────

export function getOwnedCosmetics(): string[] { return [...load().cosmeticsOwned]; }

export function isCosmeticOwned(id: string): boolean {
  const def = getCosmeticDef(id);
  if (!def) return false;
  if (def.price === 0) return true;
  return load().cosmeticsOwned.includes(id);
}

export function purchaseCosmetic(id: string): boolean {
  const def = getCosmeticDef(id);
  if (!def || def.price === 0) return false;
  if (isCosmeticOwned(id)) return false;
  const data = load();
  if (data.balance < def.price) return false;
  data.balance -= def.price;
  data.cosmeticsOwned.push(id);
  persist(data);
  return true;
}

export function getEquippedCosmetics(): EquippedLoadout {
  return { ...load().cosmeticsEquipped };
}

/** Equip an owned item into its slot, or clear the slot with null. */
export function equipCosmetic(slot: CosmeticSlot, id: string | null): boolean {
  const data = load();
  if (id === null) {
    delete data.cosmeticsEquipped[slot];
    persist(data);
    return true;
  }
  const def = getCosmeticDef(id);
  if (!def || def.slot !== slot || !isCosmeticOwned(id)) return false;
  data.cosmeticsEquipped[slot] = id;
  persist(data);
  return true;
}

export function getLoadoutSyncPending(): boolean { return load().loadoutSyncPending ?? false; }
export function setLoadoutSyncPending(v: boolean): void {
  const data = load();
  data.loadoutSyncPending = v;
  persist(data);
}

/** All per-hat fit tweaks (clamped at write time). */
export function getHatAdjustments(): HatAdjustments {
  return { ...(load().hatAdjustments ?? {}) };
}

export function getHatAdjustment(id: string): HatAdjustment {
  return load().hatAdjustments?.[id] ?? { dAngle: 0, dScale: 1 };
}

/** Set (clamped) or clear (null) the fit tweak for one hat id. */
export function setHatAdjustment(id: string, adj: HatAdjustment | null): void {
  const data = load();
  const map = data.hatAdjustments ?? {};
  if (adj === null || (adj.dAngle === 0 && adj.dScale === 1)) {
    delete map[id];
  } else {
    map[id] = clampHatAdjustment(adj);
  }
  data.hatAdjustments = map;
  persist(data);
}

// ── Cloud save merge ──────────────────────────────────────────────────────────

export function mergeCloudSave(local: RawSave, cloud: RawSave): RawSave {
  // Whichever has higher balance is treated as the "primary" for name/selection.
  const primary   = local.balance >= cloud.balance ? local : cloud;
  const secondary = local.balance >= cloud.balance ? cloud : local;

  // Union upgrades: max level per key.
  const upgrades: Record<string, number> = { ...secondary.upgrades };
  for (const [k, v] of Object.entries(primary.upgrades)) {
    upgrades[k] = Math.max(upgrades[k] ?? 0, v);
  }

  // Union inventory: max count per key.
  const inventory: Record<string, number> = { ...secondary.inventory };
  for (const [k, v] of Object.entries(primary.inventory)) {
    inventory[k] = Math.max(inventory[k] ?? 0, v);
  }

  // Union placed items: per heap, deduplicate by item id (keep first occurrence).
  const placed: Record<string, PlacedItemSave[]> = {};
  const allHeapIds = new Set([
    ...Object.keys(local.placed),
    ...Object.keys(cloud.placed),
  ]);
  for (const heapId of allHeapIds) {
    const seenIds = new Set<string>();
    const merged: PlacedItemSave[] = [];
    for (const item of [...(local.placed[heapId] ?? []), ...(cloud.placed[heapId] ?? [])]) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        merged.push(item);
      }
    }
    placed[heapId] = merged;
  }

  // Union high scores: max per heapId.
  const highScores: Record<string, number> = { ...secondary.highScores };
  for (const [k, v] of Object.entries(primary.highScores)) {
    highScores[k] = Math.max(highScores[k] ?? 0, v);
  }

  // Union owned cosmetics; equipped follows the primary save.
  const cosmeticsOwned = [...new Set([
    ...(local.cosmeticsOwned ?? []), ...(cloud.cosmeticsOwned ?? []),
  ])];

  return {
    schemaVersion: CURRENT_SCHEMA,
    balance:        Math.max(local.balance, cloud.balance),
    upgrades,
    inventory,
    placed,
    selectedHeapId: primary.selectedHeapId,
    playerGuid:     local.playerGuid,    // always keep local GUID
    playerName:     primary.playerName,
    gpgsPlayerId:   local.gpgsPlayerId ?? cloud.gpgsPlayerId,
    // Write-auth secret must ride through the merge: prefer local (it matches the
    // hash the server already stored for this device); fall back to cloud so a
    // fresh install recovers the claiming identity. Dropping it here regenerates
    // the secret on next getPlayerSecret() → permanent 403 mismatch.
    playerSecret:   local.playerSecret ?? cloud.playerSecret,
    highScores,
    cosmeticsOwned,
    cosmeticsEquipped:  { ...(primary.cosmeticsEquipped ?? {}) },
    hatAdjustments:     { ...(secondary.hatAdjustments ?? {}), ...(primary.hatAdjustments ?? {}) },
    loadoutSyncPending: local.loadoutSyncPending,
    verboseLogging: local.verboseLogging,
    adRunsSinceLast: local.adRunsSinceLast,
    adRunTarget:     local.adRunTarget,
    controlMode:     local.controlMode,   // device-local — local always wins
    joystickSide:    local.joystickSide,  // device-local — local always wins
  };
}

// ── Cloud save integration helpers ────────────────────────────────────────

export function getRawSaveForCloudSync(): RawSave { return { ...load() }; }

export function applyMergedSave(merged: RawSave): void {
  persist(merged);
}

// ── Control settings (device-local) ─────────────────────────────────────────

export function getControlMode(): 'tilt' | 'joystick' {
  return load().controlMode ?? 'tilt';
}

export function setControlMode(mode: 'tilt' | 'joystick'): void {
  const data = load();
  data.controlMode = mode;
  persist(data);
}

export function getJoystickSide(): 'left' | 'right' {
  return load().joystickSide ?? 'left';
}

export function setJoystickSide(side: 'left' | 'right'): void {
  const data = load();
  data.joystickSide = side;
  persist(data);
}

// Session-only control-mode override (NOT persisted). The tilt-availability
// watchdog sets this to 'joystick' on devices where tilt produces no data (e.g.
// iOS inside itch.io's cross-origin iframe), without overwriting the saved pref —
// so the fallback re-evaluates each launch and an explicit Tilt choice is kept.
let _sessionControlMode: 'tilt' | 'joystick' | null = null;

export function setSessionControlMode(mode: 'tilt' | 'joystick' | null): void {
  _sessionControlMode = mode;
}

/** The control mode in effect right now: the session override if set, else the
 *  saved pref. Everything that mounts/uses the live controls reads this. */
export function getEffectiveControlMode(): 'tilt' | 'joystick' {
  return _sessionControlMode ?? getControlMode();
}

// ── Sound settings ────────────────────────────────────────────────────────────

export function getSoundSettings(): SoundSettings {
  return { ...(load().soundSettings ?? DEFAULT_SOUND_SETTINGS) };
}

export function setSoundVolume(cat: keyof SoundSettings, v: number): void {
  const data = load();
  data.soundSettings = { ...(data.soundSettings ?? DEFAULT_SOUND_SETTINGS), [cat]: v };
  persist(data);
}

// ── Test helpers ──────────────────────────────────────────────────────────────

export function resetCacheForTests(): void { _cache = null; _sessionControlMode = null; }
export function getLegacyPlacedForTests(): PlacedItemSave[] | undefined { return load()._legacyPlaced; }
export function getSchemaVersionForTests(): number { return load().schemaVersion; }
