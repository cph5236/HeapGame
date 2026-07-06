//
// Cosmetic item ids + slots — the single source of truth shared by the game
// client and the Worker (which validates synced loadouts against it). Names,
// prices, and render specs are client-only and live in src/data/cosmeticDefs.ts.

export const COSMETIC_SLOTS = ['hat', 'face', 'tie', 'skin', 'trail'] as const;
export type CosmeticSlot = typeof COSMETIC_SLOTS[number];

export interface CatalogEntry {
  id:   string;
  slot: CosmeticSlot;
}

/** Equipped loadout: at most one item id per slot; missing slot = default/none. */
export type EquippedLoadout = Partial<Record<CosmeticSlot, string>>;

/** Hard cap on the serialized loadout blob the server will store. */
export const MAX_LOADOUT_JSON_LEN = 512;

export const COSMETIC_CATALOG: readonly CatalogEntry[] = [
  // ── Tie (12) ──
  { id: 'tie_red',     slot: 'tie' },
  { id: 'tie_blue',    slot: 'tie' },
  { id: 'tie_green',   slot: 'tie' },
  { id: 'tie_yellow',  slot: 'tie' },
  { id: 'tie_pink',    slot: 'tie' },
  { id: 'tie_purple',  slot: 'tie' },
  { id: 'tie_orange',  slot: 'tie' },
  { id: 'tie_cyan',    slot: 'tie' },
  { id: 'tie_black',   slot: 'tie' },
  { id: 'tie_neon',    slot: 'tie' },
  { id: 'tie_gold',    slot: 'tie' },
  { id: 'tie_rainbow', slot: 'tie' },
  // ── Skin (8) ──
  { id: 'skin_default',   slot: 'skin' },
  { id: 'skin_frost',     slot: 'skin' },
  { id: 'skin_toxic',     slot: 'skin' },
  { id: 'skin_shadow',    slot: 'skin' },
  { id: 'skin_golden',    slot: 'skin' },
  { id: 'skin_ember',     slot: 'skin' },
  { id: 'skin_bubblegum', slot: 'skin' },
  { id: 'skin_ghostly',   slot: 'skin' },
  // ── Hat (14) ──
  { id: 'hat_cone',      slot: 'hat' },
  { id: 'hat_bottlecap', slot: 'hat' },
  { id: 'hat_tincan',    slot: 'hat' },
  { id: 'hat_banana',    slot: 'hat' },
  { id: 'hat_party',     slot: 'hat' },
  { id: 'hat_crown',     slot: 'hat' },
  { id: 'hat_tophat',    slot: 'hat' },
  { id: 'hat_hardhat',   slot: 'hat' },
  { id: 'hat_propeller', slot: 'hat' },
  { id: 'hat_wizard',    slot: 'hat' },
  { id: 'hat_cowboy',    slot: 'hat' },
  { id: 'hat_boat',      slot: 'hat' },
  { id: 'hat_beanie',    slot: 'hat' },
  { id: 'hat_viking',     slot: 'hat' },
  { id: 'hat_shark',      slot: 'hat' },
  { id: 'hat_graduation', slot: 'hat' },
  { id: 'hat_fez',        slot: 'hat' },
  { id: 'hat_hotdog',     slot: 'hat' },
  { id: 'hat_umbrella',   slot: 'hat' },
  { id: 'hat_pirate',     slot: 'hat' },
  { id: 'hat_skeleton',   slot: 'hat' },
  { id: 'hat_military', slot: 'hat' },
  { id: 'hat_nurse', slot: 'hat' },
  { id: 'hat_antlers', slot: 'hat' },
  { id: 'hat_army', slot: 'hat' },
  { id: 'hat_baseball', slot: 'hat' },
  { id: 'hat_flatcap', slot: 'hat' },
  { id: 'hat_beret', slot: 'hat' },
  { id: 'hat_bowler', slot: 'hat' },
  { id: 'hat_bunny', slot: 'hat' },
  { id: 'hat_captain', slot: 'hat' },
  { id: 'hat_catears', slot: 'hat' },
  { id: 'hat_fedora', slot: 'hat' },
  { id: 'hat_fireman', slot: 'hat' },
  { id: 'hat_pompadour', slot: 'hat' },
  { id: 'hat_horsehead', slot: 'hat' },
  { id: 'hat_leprechaun', slot: 'hat' },
  { id: 'hat_lumberjack', slot: 'hat' },
  { id: 'hat_outback', slot: 'hat' },
  { id: 'hat_police', slot: 'hat' },
  { id: 'hat_princess', slot: 'hat' },
  { id: 'hat_bonnet', slot: 'hat' },
  { id: 'hat_robinhood', slot: 'hat' },
  { id: 'hat_spartan', slot: 'hat' },
  { id: 'hat_sunhat', slot: 'hat' },
  { id: 'hat_kasa', slot: 'hat' },
  { id: 'hat_tiara', slot: 'hat' },
  { id: 'hat_waldo', slot: 'hat' },
  { id: 'hat_wig', slot: 'hat' },
  { id: 'hat_pickelhaube', slot: 'hat' },
  // ── Face (10) ──
  { id: 'face_googly',       slot: 'face' },
  { id: 'face_sunglasses',   slot: 'face' },
  { id: 'face_3dglasses',    slot: 'face' },
  { id: 'face_monocle',      slot: 'face' },
  { id: 'face_eyepatch',     slot: 'face' },
  { id: 'face_mustache',     slot: 'face' },
  { id: 'face_clownnose',    slot: 'face' },
  { id: 'face_heartglasses', slot: 'face' },
  { id: 'face_goggles',      slot: 'face' },
  { id: 'face_scar',         slot: 'face' },
  // ── Trail (8) ──
  { id: 'trail_flies',   slot: 'trail' },
  { id: 'trail_stink',   slot: 'trail' },
  { id: 'trail_bubbles', slot: 'trail' },
  { id: 'trail_sparkle', slot: 'trail' },
  { id: 'trail_smoke',   slot: 'trail' },
  { id: 'trail_coins',   slot: 'trail' },
  { id: 'trail_embers',  slot: 'trail' },
  { id: 'trail_rainbow', slot: 'trail' },
];

const BY_ID = new Map(COSMETIC_CATALOG.map(e => [e.id, e]));

export function getCatalogEntry(id: string): CatalogEntry | undefined {
  return BY_ID.get(id);
}

/**
 * Validates an unknown parsed value as an equipped loadout.
 * Returns a normalized loadout (known slots only, each id existing and
 * belonging to that slot) or null if anything is invalid.
 */
export function validateLoadout(input: unknown): EquippedLoadout | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
  const out: EquippedLoadout = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!(COSMETIC_SLOTS as readonly string[]).includes(key)) return null;
    if (typeof value !== 'string') return null;
    const entry = BY_ID.get(value);
    if (!entry || entry.slot !== key) return null;
    out[key as CosmeticSlot] = value;
  }
  return out;
}
