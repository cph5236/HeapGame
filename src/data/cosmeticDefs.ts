//
// Client-side cosmetic registry: display name, coin price (0 = free), and a
// per-slot render spec. Ids/slots must mirror shared/cosmeticCatalog.ts (the
// integrity test enforces it). Designer-tunable: prices and px offsets here.

import type { CosmeticSlot } from '../../shared/cosmeticCatalog';

export type AttachmentAnim =
  | { type: 'spin';  rpm: number }
  | { type: 'bob';   periodMs: number; amplitudePx: number }
  | { type: 'pulse'; periodMs: number; scaleAmp: number; alphaAmp?: number }
  | { type: 'sheet'; frameW: number; frameH: number; frameRate: number };

export interface TieRender   { kind: 'tie';   color: number; rainbow?: boolean }
export interface SkinRender  { kind: 'skin';  tint: number }
export interface HatRender   {
  kind: 'hat';
  textureKey: string;
  offsetX: number;
  offsetY: number;
  angle:  number;   // default worn angle, degrees (designer-tuned)
  scale:  number;   // default size multiplier on ART_SCALE (designer-tuned)
  anim?:  AttachmentAnim;
}
export interface FaceRender  { kind: 'face';  textureKey: string; offsetX: number; offsetY: number; anim?: AttachmentAnim }

/** One eye of an `eyes` item. Positions in logical px relative to the
 *  attachment origin (player center + offsetX/Y); rest pose relative to the
 *  eye center. `radius` is how far the pupil may travel from the center. */
export interface EyeSpec {
  x: number; y: number;
  radius: number;
  whiteScale: number;   // multiplier on ART_SCALE for the shared white disc
  pupilScale: number;   // multiplier on ART_SCALE for the shared pupil disc
  restX: number; restY: number;
}
/** Per-item overrides for eyePhysics defaults (see DEFAULT_EYE_PHYSICS). */
export interface EyesPhysics { stiffness?: number; damping?: number; accelScale?: number }
/** Physics-driven eye family. `textureKey` stays the flat store PNG — the
 *  store grid renders it and the rig falls back to it when parts art is
 *  missing. */
export interface EyesRender {
  kind: 'eyes';
  textureKey: string;
  offsetX: number; offsetY: number;
  eyes: EyeSpec[];
  physics?: EyesPhysics;
}
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
export type CosmeticRender = TieRender | SkinRender | HatRender | FaceRender | EyesRender | TrailRender;

export interface CosmeticDef {
  id:     string;
  slot:   CosmeticSlot;
  name:   string;
  price:  number;   // coins; 0 = free (implicitly owned)
  render: CosmeticRender;
}

export const DEFAULT_TIE_COLOR = 0xff0000;

const hat  = (id: string, name: string, price: number, offsetX: number, offsetY: number,
              angle = 0, scale = 1, anim?: AttachmentAnim): CosmeticDef =>
  ({ id, slot: 'hat', name, price, render: { kind: 'hat', textureKey: `cos-${id}`, offsetX, offsetY, angle, scale, anim } });
const face = (id: string, name: string, price: number, offsetX: number, offsetY: number): CosmeticDef =>
  ({ id, slot: 'face', name, price, render: { kind: 'face', textureKey: `cos-${id}`, offsetX, offsetY } });
const eyes = (id: string, name: string, price: number, offsetX: number, offsetY: number,
              eyeSpecs: EyeSpec[], physics?: EyesPhysics): CosmeticDef =>
  ({ id, slot: 'face', name, price, render: { kind: 'eyes', textureKey: `cos-${id}`, offsetX, offsetY, eyes: eyeSpecs, physics } });
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
  hat('hat_cone',      'Traffic Cone',  800,  0, -40.23, 0, 1.24),
  hat('hat_wizard',    'Tattered Wizard', 300, -1.41, -32.0),
  hat('hat_bottlecap', 'Bottle Cap',    500,  -1.23, -23.77, 0, 1.61),
  hat('hat_tincan',    'Tin Can',       500,  -7.41, -24.14, 0, 0.63),
  hat('hat_banana',    'Banana Peel',   600,  -0.02, -34.78, 0, 1.28),
  hat('hat_party',     'Party Hat',     750,  -1.5, -28.0),
  hat('hat_crown',     'Crown',         2500, -3.5, -25.0),
  hat('hat_tophat',    'Top Hat',       1200, -1.0, -26.5),
  hat('hat_hardhat',   'Hard Hat',      800,  3, -23.5),
  hat('hat_propeller', 'Propeller Cap', 1000, -3.0, -26.5, 0, 1, { type: 'spin', rpm: 40 }),
  hat('hat_cowboy',    'Cowboy Hat',    1000, -1, -23.5),
  hat('hat_boat',      'Paper Boat',    600,  0.18, -28.92, 0, 1.31),
  hat('hat_beanie',    'Warm Hat',        500,  0.0, -25.0),
  hat('hat_viking',     'Viking Helm',   1200, -1.0, -29),
  hat('hat_shark',      'Shark Bite',    1500, -7, -27.5),
  hat('hat_graduation', 'Grad Cap',      800,  -3.0, -22.5),
  hat('hat_fez',        'Fez',           600,  -3.0, -26.0),
  hat('hat_hotdog',     'Hot Dog',       1000, -3.0, -24.5),
  hat('hat_umbrella',   'Umbrella Hat',  900,  -4.5, -27.0),
  hat('hat_pirate',     'Pirate Bicorn', 1200, -5.5, -23.5),
  hat('hat_skeleton',   'Skull Cap',     1000, -3.0, -27.5),
  hat('hat_military', 'Field Cap', 600, -1.5, -26.0),
  hat('hat_nurse', 'Nurse Cap', 600, -4.5, -26),
  hat('hat_antlers', 'Antlers', 900, -1.0, -40.0, 0, 1.5),
  hat('hat_army', 'Camo Helmet', 800, -1.0, -26.0),
  hat('hat_baseball', 'Baseball Cap', 500, 3, -22.5),
  hat('hat_flatcap', 'Tattered Beanie', 500, -8.0, -22.5),
  hat('hat_bowler', 'Bowler', 700, -0.5, -24),
  hat('hat_beret', 'Beret', 600, 0, -26.5, 0, 0.4),
  hat('hat_bunny', 'Bunny Ears', 800, 0.0, -33.0, 0, 0.8),
  hat('hat_captain', "Captain's Cap", 900, 0, -25.0),
  hat('hat_catears', 'Cat Ears', 800, 0.5, -37.5),
  hat('hat_fedora', 'Fedora', 700, 0, -26.0),
  hat('hat_fireman', 'Fire Helmet', 800, -3.0, -26),
  hat('hat_pompadour', 'Pompadour', 700, -4.5, -24.0),
  hat('hat_horsehead', 'Horse Mask', 1500, 1.5, -27.0),
  hat('hat_leprechaun', 'Lucky Hat', 900, -3.0, -27),
  hat('hat_lumberjack', 'Trapper Hat', 700, 0.5, -26.0),
  hat('hat_outback', 'Outback Hat', 700, 0, -25.5),
  hat('hat_police', 'Police Cap', 800, 0.0, -25.0),
  hat('hat_princess', 'Princess Cone', 900, -6.0, -27.0),
  hat('hat_bonnet', 'Bonnet', 600, -1.0, -26.5),
  hat('hat_robinhood', 'Archer Cap', 800, -2.0, -25.0),
  hat('hat_spartan', 'Spartan Helm', 1500, -1.0, -21.5),
  hat('hat_sunhat', 'Sun Hat', 600, -2, -25.0),
  hat('hat_kasa', 'Straw Kasa', 800, 0, -23.0),
  hat('hat_tiara', 'Tiara', 1000, 2.5, -27.0),
  hat('hat_waldo', 'Bobble Beanie', 600, -8.0, -24.5),
  hat('hat_wig', 'Flower Wig', 800, 1.5, -30.0),
  hat('hat_pickelhaube', 'Spiked Helmet', 1000, 1.0, -26.0),
  // ── Face (PNG; upper third of the bag) ──
  // ── Eye family (physics-driven pupil rigs; rest pose = item personality) ──
  eyes('face_googly', 'Googly Eyes', 500, 0, -8, [
    { x: -4.5, y: 0, radius: 2.2, whiteScale: 0.27, pupilScale: 0.12, restX: 0, restY: 1.4 },
    { x:  4.5, y: 0, radius: 2.2, whiteScale: 0.27, pupilScale: 0.12, restX: 0, restY: 1.4 },
  ], { stiffness: 30, damping: 3.5, accelScale: 0.02 }),   // loose + floppy
  eyes('face_wonkyeyes', 'Lazy Eye', 500, 0, -8, [
    { x: -4.5, y: 0, radius: 2.2, whiteScale: 0.27, pupilScale: 0.12, restX: 0, restY:  1.8 },
    { x:  4.5, y: 0, radius: 2.2, whiteScale: 0.27, pupilScale: 0.12, restX: 0, restY: -0.6 },
  ]),
  eyes('face_lazyeye', 'Crazy Eyes', 500, 0, -8, [
    { x: -4.5, y: 0, radius: 2.2, whiteScale: 0.27, pupilScale: 0.12, restX: -1.4, restY: -1.2 },
    { x:  4.5, y: 0, radius: 2.2, whiteScale: 0.27, pupilScale: 0.12, restX:  1.4, restY:  1.2 },
  ]),
  eyes('face_walleyes', 'Cross-Eyes', 500, 0, -8, [
    { x: -4.5, y: 0, radius: 2.2, whiteScale: 0.27, pupilScale: 0.12, restX:  1.4, restY: 0.6 },
    { x:  4.5, y: 0, radius: 2.2, whiteScale: 0.27, pupilScale: 0.12, restX: -1.4, restY: 0.6 },
  ]),
  face('face_3dglasses',    '3D Glasses',    600, 0, -8),
  face('face_3dstripes',    'Retro 3D Shades',650, 0, -8),
  face('face_clearglasses', 'Clear Glasses',  400, 0, -8),
  face('face_shutter',      'Shutter Shades', 600, 0, -8),
  face('face_shutterred',   'Red Shades',    650, 0, -8),
  face('face_shutterblue',  'Blue Shades',   650, 0, -8),
  face('face_shuttergreen', 'Green Shades',  650, 0, -8),
  face('face_shutterorange','Orange Shades', 650, 0, -8),
  face('face_shutterpink',  'Pink Shades',   650, 0, -8),
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
