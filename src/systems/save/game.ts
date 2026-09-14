import { UPGRADE_DEFS } from '../../data/upgradeDefs';
import { ITEM_DEFS } from '../../data/itemDefs';
import { getCosmeticDef } from '../../data/cosmeticDefs';
import { clampHatAdjustment, type HatAdjustment, type HatAdjustments } from '../cosmeticsLogic';
import type { EquippedLoadout, CosmeticSlot } from '../../../shared/cosmeticCatalog';
import {
  MAX_WALKABLE_SLOPE_DEG, MOUNTAIN_CLIMBER_INCREMENT, MONEY_MULT_PER_LEVEL,
  BASE_STAMINA, STAMINA_REGEN_AIR_MS, STAMINA_REGEN_PER_LEVEL,
  WALL_JUMP_COOLDOWN_MS, WALL_JUMP_CD_PER_LEVEL, WALL_JUMP_CD_MIN_MS,
  DASH_POWER_PER_LEVEL,
} from '../../constants';
import {
  load as coreLoad, persist, setSaveExtension, setPrimaryPicker,
  type RawSave, type CoreSave,
} from './core';

/** Core stores game fields opaquely (it must, to stay game-agnostic), so the
 *  accessors below read the same record through this game's own types. Same
 *  cache, same object — a narrowed view, not a copy. */
export function load(): CoreSave & GameSave { return coreLoad() as CoreSave & GameSave; }

// World height at each schema version — used to remap placed item Y values.
const WORLD_HEIGHT_V2 = 50_000;
const WORLD_HEIGHT_V3 = 5_000_000;

export interface PlacedItemSave {
  id:    string;
  x:     number;
  y:     number;
  meta?: Record<string, number>;
}

/** The half of the save this game owns. Core stores these opaquely; every rule
 *  about how they migrate and merge lives in this file, so deleting it leaves a
 *  working platform save behind. */
export interface GameSave {
  balance:        number;
  upgrades:       Record<string, number>;
  inventory:      Record<string, number>;
  placed:         Record<string, PlacedItemSave[]>;
  selectedHeapId: string;
  highScores:     Record<string, number>;
  /** Heaps this player has beaten (any successful placement). Required, not
   *  optional: the merge returns a hand-built literal, and an optional field
   *  silently vanishes there instead of failing the build. */
  beatenHeapIds:  string[];
  cosmeticsOwned:      string[];
  cosmeticsEquipped:   EquippedLoadout;
  loadoutSyncPending?: boolean;
  hatAdjustments?:     HatAdjustments;   // per-hat-id fit tweaks (dAngle/dScale)
  tutorialDone?:   boolean;
  menuTutorialSeen?: boolean;  // has the player finished (or skipped) the main-menu coach-mark tour?
  _legacyPlaced?: PlacedItemSave[];
  adRunsSinceLast?: number;
  adRunTarget?:     number;
  /** One-time flag: the movement-rework refund has been paid for this save
   *  lineage. Merged with || like the other one-time flags. NOT keyed on
   *  schemaVersion — an old client can downgrade the stamp on a save that has
   *  already been refunded. See the design doc's Migration section. */
  movementRefundApplied?: boolean;
  /** What this player actually got back, for the announcement to display. */
  movementRefundAmount?:  number;
  /** Ids of one-time announcements this player has dismissed. */
  seenAnnouncements?:     string[];
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
// ── Player config ─────────────────────────────────────────────────────────────

export interface PlayerConfig {
  maxAirJumps:         number;  // per-airtime AIR JUMP CAP, not a stamina budget
  baseStamina:         number;
  staminaRegenAirMs:   number;
  wallJumpCooldownMs:  number;
  dashPower:           number;  // added to PLAYER_DASH_VELOCITY
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
    baseStamina:        BASE_STAMINA + getUpgradeLevel('max_stamina'),
    staminaRegenAirMs:  Math.max(
      STAMINA_REGEN_AIR_MS - getUpgradeLevel('stamina_regen') * STAMINA_REGEN_PER_LEVEL,
      STAMINA_REGEN_PER_LEVEL,
    ),
    wallJumpCooldownMs: Math.max(
      WALL_JUMP_COOLDOWN_MS - getUpgradeLevel('wall_jump_cd') * WALL_JUMP_CD_PER_LEVEL,
      WALL_JUMP_CD_MIN_MS,
    ),
    dashPower:          getUpgradeLevel('dash_power') * DASH_POWER_PER_LEVEL,
    moneyMultiplier:     1 + getUpgradeLevel('money_mult') * MONEY_MULT_PER_LEVEL,
    jumpBoost:           [0, 25, 35, 45, 55, 60, 65, 70, 75][jl],
    stompBonus:          [25, 40, 50, 60][sl],
    peakMultiplier:      [1.0, 1.25, 1.50, 1.75, 2.00][pl],
    maxWalkableSlopeDeg: MAX_WALKABLE_SLOPE_DEG + getUpgradeLevel('mountain_climber') * MOUNTAIN_CLIMBER_INCREMENT,
  };
}
// ── Tutorial done flag ─────────────────────────────────────────────────────────

export function getTutorialDone(): boolean { return load().tutorialDone ?? false; }
export function setTutorialDone(value: boolean): void {
  const data = load();
  persist({ ...data, tutorialDone: value });
}

// ── Menu tutorial seen flag ─────────────────────────────────────────────────────

export function getMenuTutorialSeen(): boolean { return load().menuTutorialSeen ?? false; }
export function setMenuTutorialSeen(value: boolean): void {
  const data = load();
  persist({ ...data, menuTutorialSeen: value });
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

// ── Beaten heaps (heap-lock feature) ─────────────────────────────────────────

export function getBeatenHeapIds(): string[] { return [...load().beatenHeapIds]; }

export function markHeapBeaten(heapId: string): void {
  const data = load();
  if (data.beatenHeapIds.includes(heapId)) return;
  data.beatenHeapIds.push(heapId);
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

// ── Save extension: how these fields are born, migrated and merged ────────────

function freshGame(): GameSave {
  return {
    balance:        0,
    upgrades:       {},
    inventory:      {},
    placed:         {},
    selectedHeapId: '',
    highScores:     {},
    beatenHeapIds:  [],
    cosmeticsOwned: [],
    cosmeticsEquipped: {},
    tutorialDone:   false,
    menuTutorialSeen: false,
    // A genuinely new player never used air-jump charges / paid for dash,
    // wall jump or dive, so there is nothing to explain to them — and this
    // must NOT set movementRefundApplied (see reconcileMovementRefund below).
    seenAnnouncements: [MOVEMENT_ANNOUNCEMENT_ID],
  };
}

function migrateGame(parsed: any, version: number): GameSave {
  // v5 and anything newer share this layout. Written as >= so the next
  // CURRENT_SCHEMA bump doesn't drop every live save into the v2->v3
  // remap fall-through below (which wipes cosmetics and offsets placed Y).
  if (version >= 5) {
    return {
      balance:        parsed.balance        ?? 0,
      upgrades:       parsed.upgrades       ?? {},
      inventory:      parsed.inventory      ?? {},
      placed:         parsed.placed         ?? {},
      selectedHeapId: parsed.selectedHeapId ?? '',
      highScores:     parsed.highScores     ?? {},
      beatenHeapIds:  parsed.beatenHeapIds  ?? [],
      cosmeticsOwned: parsed.cosmeticsOwned ?? [],
      cosmeticsEquipped: parsed.cosmeticsEquipped ?? {},
      loadoutSyncPending: parsed.loadoutSyncPending,
      hatAdjustments: parsed.hatAdjustments,
      tutorialDone:   parsed.tutorialDone   ?? true,
      menuTutorialSeen: parsed.menuTutorialSeen,
      _legacyPlaced:  parsed._legacyPlaced,
      adRunsSinceLast: parsed.adRunsSinceLast,
      adRunTarget:     parsed.adRunTarget,
      movementRefundApplied: parsed.movementRefundApplied,
      movementRefundAmount:  parsed.movementRefundAmount,
      seenAnnouncements:     parsed.seenAnnouncements,
    };
  }

  // v1: `placed` is a flat array, no schemaVersion.
  if (version === 1) {
    const legacyArray: PlacedItemSave[] = Array.isArray(parsed?.placed) ? parsed.placed : [];
    return {
      balance:        parsed.balance    ?? 0,
      upgrades:       parsed.upgrades   ?? {},
      inventory:      parsed.inventory  ?? {},
      placed:         {},
      selectedHeapId: '',
      highScores:     parsed.highScores ?? {},
      beatenHeapIds:  [],
      cosmeticsOwned: [],
      cosmeticsEquipped: {},
      tutorialDone:   parsed.tutorialDone ?? true,
      // v1 items have no world-height context — leave Y as-is; can't safely remap
      _legacyPlaced:  legacyArray.length > 0 ? legacyArray : undefined,
    };
  }

  // v4 → v5: identical layout, just add the cosmetics fields. Must NOT fall
  // through to the v2→v3 branch below, which remaps placed-item Y values.
  if (version === 4) {
    return {
      balance:        parsed.balance        ?? 0,
      upgrades:       parsed.upgrades       ?? {},
      inventory:      parsed.inventory      ?? {},
      placed:         parsed.placed         ?? {},
      selectedHeapId: parsed.selectedHeapId ?? '',
      highScores:     parsed.highScores     ?? {},
      beatenHeapIds:  [],
      cosmeticsOwned:    [],
      cosmeticsEquipped: {},
      tutorialDone:   parsed.tutorialDone   ?? true,
      _legacyPlaced:  parsed._legacyPlaced,
      adRunsSinceLast: parsed.adRunsSinceLast,
      adRunTarget:     parsed.adRunTarget,
    };
  }

  // v2 -> v3 raised the world height, so placed items need their Y remapped.
  // Narrowly scoped on purpose: anything that is not 1, 2, 4 or >=5 is an
  // unknown or rolled-back-client version, and must pass through WITHOUT the
  // remap rather than being offset by +4 950 000.
  if (version === 2) {
    const placed: Record<string, PlacedItemSave[]> = parsed.placed ?? {};
    return {
      balance:        parsed.balance        ?? 0,
      upgrades:       parsed.upgrades       ?? {},
      inventory:      parsed.inventory      ?? {},
      placed:         remapPlacedY(placed, WORLD_HEIGHT_V2, WORLD_HEIGHT_V3),
      selectedHeapId: parsed.selectedHeapId ?? '',
      highScores:     parsed.highScores     ?? {},
      beatenHeapIds:  [],
      cosmeticsOwned: [],
      cosmeticsEquipped: {},
      tutorialDone:   parsed.tutorialDone   ?? true,
      _legacyPlaced:  parsed._legacyPlaced,
    };
  }

  // Unknown / newer / v3: pass through with no remap and no field loss.
  return {
    balance:        parsed.balance        ?? 0,
    upgrades:       parsed.upgrades       ?? {},
    inventory:      parsed.inventory      ?? {},
    placed:         parsed.placed         ?? {},
    selectedHeapId: parsed.selectedHeapId ?? '',
    highScores:     parsed.highScores     ?? {},
    beatenHeapIds:  parsed.beatenHeapIds  ?? [],
    cosmeticsOwned: parsed.cosmeticsOwned ?? [],
    cosmeticsEquipped: parsed.cosmeticsEquipped ?? {},
    loadoutSyncPending: parsed.loadoutSyncPending,
    hatAdjustments: parsed.hatAdjustments,
    tutorialDone:   parsed.tutorialDone   ?? true,
    menuTutorialSeen: parsed.menuTutorialSeen,
    _legacyPlaced:  parsed._legacyPlaced,
    adRunsSinceLast: parsed.adRunsSinceLast,
    adRunTarget:     parsed.adRunTarget,
    movementRefundApplied: parsed.movementRefundApplied,
    movementRefundAmount:  parsed.movementRefundAmount,
    seenAnnouncements:     parsed.seenAnnouncements,
  };
}

/** Whichever save has the higher balance is treated as the "primary" for
 *  name/selection. Core asks for this when merging the player name. */
function primaryOf(local: RawSave, cloud: RawSave): RawSave {
  return local.balance >= cloud.balance ? local : cloud;
}

function mergeGame(local: RawSave, cloud: RawSave): GameSave {
  const primary   = primaryOf(local, cloud);
  const secondary = local.balance >= cloud.balance ? cloud : local;

  // Union upgrades: max level per key.
  const upgrades: Record<string, number> = { ...secondary.upgrades };
  for (const [k, v] of Object.entries(primary.upgrades as Record<string, number>)) {
    upgrades[k] = Math.max(upgrades[k] ?? 0, v);
  }

  // Union inventory: max count per key.
  const inventory: Record<string, number> = { ...secondary.inventory };
  for (const [k, v] of Object.entries(primary.inventory as Record<string, number>)) {
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
  for (const [k, v] of Object.entries(primary.highScores as Record<string, number>)) {
    highScores[k] = Math.max(highScores[k] ?? 0, v);
  }

  // Union owned cosmetics; equipped follows the primary save.
  const cosmeticsOwned = [...new Set([
    ...(local.cosmeticsOwned ?? []), ...(cloud.cosmeticsOwned ?? []),
  ])] as string[];

  // Union beaten heaps — a heap beaten on either device stays beaten.
  const beatenHeapIds = [...new Set([
    ...(local.beatenHeapIds ?? []), ...(cloud.beatenHeapIds ?? []),
  ])] as string[];

  return {
    // Spread both inputs first so any game field this build does not know
    // about survives the merge. Without this, a field written only by a NEWER
    // client is dropped by the hand-built literal below — the same way the
    // schema stamp is — and one-time flags like movementRefundApplied become
    // as fragile as the version they replaced. Explicit rules below still win.
    ...(secondary as object),
    ...(primary as object),
    balance:        Math.max(local.balance, cloud.balance),
    upgrades,
    inventory,
    placed,
    selectedHeapId: primary.selectedHeapId,
    highScores,
    beatenHeapIds,
    cosmeticsOwned,
    cosmeticsEquipped:  { ...(primary.cosmeticsEquipped ?? {}) },
    hatAdjustments:     { ...(secondary.hatAdjustments ?? {}), ...(primary.hatAdjustments ?? {}) },
    loadoutSyncPending: local.loadoutSyncPending,
    adRunsSinceLast: local.adRunsSinceLast,
    adRunTarget:     local.adRunTarget,
    // One-time UI flags: seen/done on either device counts, so a signed-in merge
    // never re-nags. (Previously dropped here → hint/tutorial reappeared each launch.)
    menuTutorialSeen: local.menuTutorialSeen || cloud.menuTutorialSeen,
    tutorialDone:      local.tutorialDone      || cloud.tutorialDone,
    // Explicit `||` merge key, not left to the spreads above: the refund
    // reconciliation DELETES the wall_jump/dash/dive upgrade keys, and a stale
    // side of the merge that still carries them will resurrect them via the
    // upgrades union above. Only this flag — never key-absence — prevents a
    // resurrected key from paying the refund a second time.
    movementRefundApplied: local.movementRefundApplied || cloud.movementRefundApplied,
    movementRefundAmount:  Math.max(local.movementRefundAmount ?? 0, cloud.movementRefundAmount ?? 0),
    seenAnnouncements: [...new Set([
      ...(local.seenAnnouncements ?? []), ...(cloud.seenAnnouncements ?? []),
    ])],
  };
}

// Registered at module load. The `SaveData` barrel imports this file, so the
// extension is always installed before anything can call load().
setSaveExtension({ fresh: freshGame, migrate: migrateGame, merge: mergeGame });
setPrimaryPicker(primaryOf);

// ── Movement rework: one-time Scrap refund + announcement ─────────────────────

/** Purchase prices of the upgrades removed by the movement rework, frozen as
 *  historical constants. Deliberately NOT read from UPGRADE_DEFS: those entries
 *  are deleted, so a lookup would return 0 and silently refund nothing. */
const MOVEMENT_REFUND_PRICES: Record<string, number> = {
  wall_jump: 450, dash: 600, dive: 500,
};

export const MOVEMENT_ANNOUNCEMENT_ID = 'movement-v0.4';

/**
 * Pay back Scrap spent on upgrades the movement rework made default-unlocked.
 *
 * MUST run after any cloud merge has either landed or been ruled out, never
 * inside migrateGame. Migration happens at load(), the GPGS merge happens
 * later, and mergeGame resolves balance with Math.max — so a refund applied
 * while a merge is still pending is double-credited the moment one device has
 * already spent it. Running post-merge against the reconciled upgrade map
 * pays exactly once. This module does not know whether a merge is pending or
 * has already been ruled out — that is a boot-sequencing fact only the caller
 * has — so it deliberately does not call `syncSaveToCloud()` itself; the
 * caller does that (and only that) when this returns a positive amount. See
 * `bootSequence.ts`'s `startIdentitySession` for the one call site and why it
 * is safe there.
 *
 * Safe to call repeatedly; the flag makes it a no-op (returns 0) after the
 * first payout.
 *
 * @returns the amount refunded on THIS call — 0 if already applied, or if the
 *  player owned none of the removed upgrades. Use `getMovementRefundAmount()`
 *  to read the (persisted) amount from a past call.
 */
export function reconcileMovementRefund(): number {
  const data = load();
  if (data.movementRefundApplied) return 0;

  let amount = 0;
  for (const [id, price] of Object.entries(MOVEMENT_REFUND_PRICES)) {
    if ((data.upgrades[id] ?? 0) > 0) {
      amount += price;
      delete data.upgrades[id];
    }
  }

  data.balance              += amount;
  data.movementRefundAmount  = amount;
  data.movementRefundApplied = true;
  // Persist unconditionally: load() only writes when the stored version differs
  // from CURRENT_SCHEMA, so relying on that side effect would recompute the
  // refund every launch and never save it.
  persist(data);
  return amount;
}

export function getMovementRefundAmount(): number {
  return load().movementRefundAmount ?? 0;
}

export function hasSeenAnnouncement(id: string): boolean {
  return (load().seenAnnouncements ?? []).includes(id);
}

export function markAnnouncementSeen(id: string): void {
  const data = load();
  const seen = new Set(data.seenAnnouncements ?? []);
  seen.add(id);
  data.seenAnnouncements = [...seen];
  persist(data);
}

// ── Test helpers ──────────────────────────────────────────────────────────────

export function getLegacyPlacedForTests(): PlacedItemSave[] | undefined { return load()._legacyPlaced; }
