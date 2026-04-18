export interface PortalDef {
  bandsPerPair:     number;  // one portal pair every N bands
  minHeightDelta:   number;  // min Y difference between paired portals (px)
  maxHeightDelta:   number;  // max Y difference
  invincibilityMs:  number;  // player invincibility after teleport
  width:            number;  // portal hitbox width
  height:           number;  // portal hitbox height
}

export const PORTAL_DEF: PortalDef = {
  bandsPerPair:    3,
  minHeightDelta:  500,
  maxHeightDelta:  3_000,
  invincibilityMs: 2_000,
  width:           40,
  height:          50,
};
