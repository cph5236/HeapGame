//
// Client-side cosmetic registry: display name, coin price (0 = free), and a
// per-slot render spec. Ids/slots must mirror shared/cosmeticCatalog.ts (the
// integrity test enforces it). Designer-tunable: prices and px offsets here.

import type { CosmeticSlot } from '../../shared/cosmeticCatalog';

export interface TieRender   { kind: 'tie';   color: number; rainbow?: boolean }
export interface SkinRender  { kind: 'skin';  tint: number }
export interface HatRender   { kind: 'hat';   textureKey: string; offsetX: number; offsetY: number }
export interface FaceRender  { kind: 'face';  textureKey: string; offsetX: number; offsetY: number }
export interface TrailRender {
  kind: 'trail';
  textureKey: string;          // procedural particle texture (see TextureGenerators)
  tint:       number;
  frequency:  number;          // ms between emissions
  speedY:     [number, number];
  lifespan:   number;          // ms
  scale:      [number, number]; // start → end
  alpha:      number;
}
export type CosmeticRender = TieRender | SkinRender | HatRender | FaceRender | TrailRender;

export interface CosmeticDef {
  id:     string;
  slot:   CosmeticSlot;
  name:   string;
  price:  number;   // coins; 0 = free (implicitly owned)
  render: CosmeticRender;
}

export const DEFAULT_TIE_COLOR = 0xff0000;

const hat  = (id: string, name: string, price: number, offsetX: number, offsetY: number): CosmeticDef =>
  ({ id, slot: 'hat', name, price, render: { kind: 'hat', textureKey: `cos-${id}`, offsetX, offsetY } });
const face = (id: string, name: string, price: number, offsetX: number, offsetY: number): CosmeticDef =>
  ({ id, slot: 'face', name, price, render: { kind: 'face', textureKey: `cos-${id}`, offsetX, offsetY } });
const tie  = (id: string, name: string, price: number, color: number, rainbow = false): CosmeticDef =>
  ({ id, slot: 'tie', name, price, render: { kind: 'tie', color, rainbow } });
const skin = (id: string, name: string, price: number, tint: number): CosmeticDef =>
  ({ id, slot: 'skin', name, price, render: { kind: 'skin', tint } });

export const COSMETIC_DEFS: readonly CosmeticDef[] = [
  // ── Tie colors (strings drawn by PlayerAnimator) ──
  tie('tie_red',     'Red',     0,    0xff0000),
  tie('tie_blue',    'Blue',    0,    0x3377ff),
  tie('tie_green',   'Green',   0,    0x33cc55),
  tie('tie_yellow',  'Yellow',  0,    0xffdd33),
  tie('tie_pink',    'Pink',    250,  0xff66aa),
  tie('tie_purple',  'Purple',  250,  0xaa55ff),
  tie('tie_orange',  'Orange',  250,  0xff8822),
  tie('tie_cyan',    'Cyan',    250,  0x33ddee),
  tie('tie_black',   'Black',   250,  0x222222),
  tie('tie_neon',    'Neon',    250,  0x39ff14),
  tie('tie_gold',    'Gold',    500,  0xd9a520),
  tie('tie_rainbow', 'Rainbow', 2000, 0xff0000, true),
  // ── Bag skins (multiplicative sprite tint; hues that read on the dark bag) ──
  skin('skin_default',   'Classic',   0,   0xffffff),
  skin('skin_frost',     'Frosty',    500, 0x99bbff),
  skin('skin_toxic',     'Toxic',     500, 0x88dd66),
  skin('skin_shadow',    'Shadow',    500, 0x555566),
  skin('skin_golden',    'Golden',    500, 0xddbb55),
  skin('skin_ember',     'Ember',     500, 0xff8866),
  skin('skin_bubblegum', 'Bubblegum', 500, 0xff99cc),
  skin('skin_ghostly',   'Ghostly',   500, 0xaaffdd),
  // ── Hats (PNG; offsets from bag center, bag top edge at y=-23) ──
  hat('hat_cone',      'Traffic Cone',  800,  0, -26),
  hat('hat_bottlecap', 'Bottle Cap',    500,  0, -24),
  hat('hat_tincan',    'Tin Can',       500,  0, -25),
  hat('hat_banana',    'Banana Peel',   600,  0, -24),
  hat('hat_party',     'Party Hat',     750,  2, -27),
  hat('hat_crown',     'Crown',         2500, 0, -25),
  hat('hat_tophat',    'Top Hat',       1200, 0, -27),
  hat('hat_hardhat',   'Hard Hat',      800,  0, -25),
  hat('hat_propeller', 'Propeller Cap', 1000, 0, -26),
  hat('hat_wizard',    'Wizard Hat',    1500, 0, -28),
  hat('hat_cowboy',    'Cowboy Hat',    1000, 0, -25),
  hat('hat_boat',      'Paper Boat',    600,  0, -25),
  hat('hat_beanie',    'Beanie',        500,  0, -24),
  hat('hat_fishbone',  'Fish Skeleton', 900,  0, -25),
  // ── Face (PNG; upper third of the bag) ──
  face('face_googly',       'Googly Eyes',   500, 0, -8),
  face('face_sunglasses',   'Sunglasses',    600, 0, -8),
  face('face_3dglasses',    '3D Glasses',    600, 0, -8),
  face('face_monocle',      'Monocle',       800, 5, -8),
  face('face_eyepatch',     'Eye Patch',     600, -4, -9),
  face('face_mustache',     'Mustache',      700, 0, -2),
  face('face_clownnose',    'Clown Nose',    500, 0, -5),
  face('face_heartglasses', 'Heart Glasses', 800, 0, -8),
  face('face_goggles',      'Ski Goggles',   700, 0, -8),
  face('face_scar',         'Sticker Scar',  500, 6, -10),
  // ── Trails (particle emitters; textures generated in TextureGenerators) ──
  { id: 'trail_flies',   slot: 'trail', name: 'Buzzing Flies',  price: 750,
    render: { kind: 'trail', textureKey: 'cos-fly',    tint: 0x333322, frequency: 90,  speedY: [-30, 30],  lifespan: 700,  scale: [1, 0.6],   alpha: 0.9 } },
  { id: 'trail_stink',   slot: 'trail', name: 'Stink Lines',    price: 750,
    render: { kind: 'trail', textureKey: 'cos-puff',   tint: 0x77cc44, frequency: 140, speedY: [-60, -20], lifespan: 900,  scale: [0.7, 1.3], alpha: 0.5 } },
  { id: 'trail_bubbles', slot: 'trail', name: 'Bubbles',        price: 900,
    render: { kind: 'trail', textureKey: 'cos-bubble', tint: 0xbbddff, frequency: 120, speedY: [-50, -15], lifespan: 1100, scale: [0.6, 1],   alpha: 0.8 } },
  { id: 'trail_sparkle', slot: 'trail', name: 'Sparkles',       price: 1200,
    render: { kind: 'trail', textureKey: 'cos-star',   tint: 0xffffaa, frequency: 80,  speedY: [-20, 20],  lifespan: 600,  scale: [1, 0.2],   alpha: 1 } },
  { id: 'trail_smoke',   slot: 'trail', name: 'Smoke Puffs',    price: 900,
    render: { kind: 'trail', textureKey: 'cos-puff',   tint: 0x888888, frequency: 130, speedY: [-40, -10], lifespan: 1000, scale: [0.8, 1.6], alpha: 0.45 } },
  { id: 'trail_coins',   slot: 'trail', name: 'Coin Glints',    price: 1500,
    render: { kind: 'trail', textureKey: 'cos-coin',   tint: 0xffcc33, frequency: 150, speedY: [10, 60],   lifespan: 800,  scale: [1, 0.4],   alpha: 1 } },
  { id: 'trail_embers',  slot: 'trail', name: 'Embers',         price: 1200,
    render: { kind: 'trail', textureKey: 'cos-dot',    tint: 0xff6622, frequency: 70,  speedY: [-70, -20], lifespan: 750,  scale: [1, 0.3],   alpha: 0.9 } },
  { id: 'trail_rainbow', slot: 'trail', name: 'Rainbow Streak', price: 1500,
    render: { kind: 'trail', textureKey: 'cos-dot',    tint: 0xffffff, frequency: 40,  speedY: [-10, 10],  lifespan: 500,  scale: [1.4, 0.2], alpha: 0.9 } },
];

const DEF_BY_ID = new Map(COSMETIC_DEFS.map(d => [d.id, d]));

export function getCosmeticDef(id: string): CosmeticDef | undefined {
  return DEF_BY_ID.get(id);
}
