/**
 * sprite-config.mjs
 *
 * Shared configuration for sprite generation scripts.
 * Edit FOLDER_RARITY to control how often each folder's sprites appear
 * in the composite heap texture and (eventually) at runtime.
 *
 * Rarity is 0 → 1:
 *   1.0 = full share of texture stamps proportional to folder size
 *   0.5 = half as likely as a folder with rarity 1.0 of the same size
 *   0.0 = excluded entirely
 *
 * The weight assigned to each individual sprite is:  rarity / spriteCount
 * This means a folder with 283 sprites at rarity 0.2 contributes the same
 * total "screen presence" as a folder with 10 sprites at rarity ~0.007.
 */

export const SPRITES_SUBDIR = 'Heap_sprites';   // under src/sprites/

/**
 * Per-folder rarity values.
 * Folders not listed here (or set to 0) are skipped entirely.
 */
export const FOLDER_RARITY = {
  Individual_items:         1.0,
  Boxes:                    0.6,
  recycle_items:            1.0,
  russiancars_pack1_side:   0.2,
};

/**
 * Per-folder scale multipliers applied when stamping sprites onto the
 * composite texture. Does not affect in-game sprite sizes.
 *
 * 1.0 = natural size, 0.5 = half size, 2.0 = double size.
 * Use this to keep visually large items (cars) from overwhelming
 * smaller items (recycling, boxes) in the heap texture.
 */
export const FOLDER_SCALE = {
  Individual_items:         0.6,
  Boxes:                    0.4,
  recycle_items:            0.2,
  russiancars_pack1_side:   2.0,
};

/**
 * Number of 960×1024 tiles to generate.
 * The heap renderer cycles through them by world-Y position, reducing
 * visible seams from texture repetition.
 * Stamps are distributed evenly across all tiles.
 */
export const TILE_COUNT = 4;

/**
 * Number of sprite stamps per tile.
 * Total stamps = STAMPS_PER_TILE × TILE_COUNT.
 */
export const STAMPS_PER_TILE = 1500;
