import type { ItemId } from '../../shared/itemIds';

/** Per-item accent color (0xRRGGBB). Single source of truth shared by the store
 *  rows and the in-game backpack tray. */
export const ACCENT_COLORS: Record<ItemId, number> = {
  ladder:     0x44cc88,
  ibeam:      0x4488ff,
  checkpoint: 0xffaa22,
  shield:     0xcc44ff,
  revive:     0xff5577,
  adrenaline: 0xff7733,
  pogo:       0x33ddff,
  stall:      0xaa88ff,
};
