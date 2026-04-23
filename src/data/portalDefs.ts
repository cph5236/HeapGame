import portalUrl from '../sprites/Portal/Trashcan-portal.png?url';

export interface PortalDef {
  spawnPortalEveryY:  [number, number];  // [min, max] px of climb between entrance spawns
  portalRange:        [number, number];  // [min, max] px above entrance to place exit
  invincibilityMs:    number;
  width:              number;
  height:             number;
  clearanceRequired:  number;            // px of clear air above surface point
  spriteKey:          string;            // Phaser texture key
  spritePath:         string;            // Vite-resolved asset URL, loaded in BootScene
}

export const PORTAL_DEF: PortalDef = {
  spawnPortalEveryY:  [200, 400],
  portalRange:        [300, 500],
  invincibilityMs:    2_000,
  width:              40,
  height:             50,
  clearanceRequired:  72,               // PLAYER_HEIGHT (46) * 1.5 ≈ 69, rounded to 72
  spriteKey:          'portal-trashcan',
  spritePath:         portalUrl,
};
