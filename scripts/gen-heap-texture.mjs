/**
 * gen-heap-texture.mjs
 *
 * Generates TILE_COUNT heap texture tiles (composite-heap-0.png … composite-heap-N.png)
 * by stamping sprites onto a tall canvas then slicing every 1024px.
 *
 * Sprites are selected via weighted random sampling: each sprite's weight is
 *   rarity / folderSpriteCount
 * so a large folder doesn't dominate regardless of sprite count.
 * Each sprite is scaled by its folder's FOLDER_SCALE before stamping.
 *
 * Also writes src/data/heapTileUrls.ts so BootScene can load all tiles
 * without hardcoding import counts.
 *
 * Adjust rarity, scale, and tile settings in scripts/sprite-config.mjs.
 *
 * Run: node scripts/gen-heap-texture.mjs
 * Commit the output PNGs and heapTileUrls.ts to source control.
 */

import sharp from 'sharp';
import { writeFileSync, readdirSync, mkdirSync } from 'fs';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';
import { FOLDER_RARITY, FOLDER_SCALE, SPRITES_SUBDIR, TILE_COUNT, STAMPS_PER_TILE } from './sprite-config.mjs';

const __dirname   = dirname(fileURLToPath(import.meta.url));
const SPRITES_DIR = join(__dirname, '..', 'src', 'sprites', SPRITES_SUBDIR);
const ASSETS_DIR  = join(__dirname, '..', 'src', 'assets');
const OUT_URLS    = join(__dirname, '..', 'src', 'data', 'heapTileUrls.ts');

const CANVAS_W      = 960;
const TILE_H        = 1024;
const CANVAS_H      = TILE_H * TILE_COUNT;
const STAMP_COUNT   = STAMPS_PER_TILE * TILE_COUNT;

/** Seeded PRNG (mulberry32) for reproducible output */
function makePrng(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = makePrng(0xdeadbeef);

// ---------------------------------------------------------------------------
// Load sprites — apply folder scale at load time
// ---------------------------------------------------------------------------

const folders = Object.keys(FOLDER_RARITY).filter(f => FOLDER_RARITY[f] > 0);

/** @type {{ pngBuffer: Buffer, width: number, height: number, weight: number, label: string }[]} */
const items = [];

for (const folder of folders) {
  const folderPath = join(SPRITES_DIR, folder);
  let files;
  try {
    files = readdirSync(folderPath)
      .filter(f => extname(f).toLowerCase() === '.png')
      .sort();
  } catch {
    console.warn(`  ⚠ Folder not found, skipping: ${folderPath}`);
    continue;
  }

  const rarity = FOLDER_RARITY[folder];
  const scale  = FOLDER_SCALE[folder] ?? 1.0;
  const perSpriteWeight = rarity / files.length;

  console.log(`📁 ${folder}  rarity: ${rarity}  scale: ${scale}  sprites: ${files.length}  weight/sprite: ${perSpriteWeight.toFixed(5)}`);

  for (const filename of files) {
    const pngPath = join(folderPath, filename);
    const meta = await sharp(pngPath).metadata();

    const scaledW = Math.max(1, Math.round(meta.width  * scale));
    const scaledH = Math.max(1, Math.round(meta.height * scale));

    const pngBuffer = await sharp(pngPath)
      .resize(scaledW, scaledH, { fit: 'fill' })
      .png()
      .toBuffer();

    items.push({
      pngBuffer,
      width: scaledW,
      height: scaledH,
      weight: perSpriteWeight,
      label: `${folder}/${filename}`,
    });
  }
}

console.log(`\nLoaded ${items.length} sprites total across ${folders.length} folders.`);

// ---------------------------------------------------------------------------
// Cumulative weight table for O(log n) weighted sampling
// ---------------------------------------------------------------------------

const cumWeights = [];
let total = 0;
for (const item of items) {
  total += item.weight;
  cumWeights.push(total);
}

function weightedPick() {
  const r = rand() * total;
  let lo = 0, hi = cumWeights.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumWeights[mid] < r) lo = mid + 1;
    else hi = mid;
  }
  return items[lo];
}

// ---------------------------------------------------------------------------
// Build tall composite canvas
// ---------------------------------------------------------------------------

console.log(`\nCompositing ${STAMP_COUNT} stamps onto ${CANVAS_W}×${CANVAS_H} canvas (${TILE_COUNT} tiles × ${STAMPS_PER_TILE} stamps)…`);

let canvas = await sharp({
  create: {
    width:    CANVAS_W,
    height:   CANVAS_H,
    channels: 4,
    background: { r: 18, g: 20, b: 35, alpha: 1 },
  },
}).png().toBuffer();

const composites = [];

for (let i = 0; i < STAMP_COUNT; i++) {
  const item = weightedPick();

  const rotDeg = Math.floor(rand() * 24) * 15;

  const rotated = await sharp(item.pngBuffer)
    .rotate(rotDeg, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const meta = await sharp(rotated).metadata();
  const rw = meta.width;
  const rh = meta.height;

  const left = Math.round(rand() * (CANVAS_W + rw)) - Math.round(rw / 2);
  const top  = Math.round(rand() * (CANVAS_H + rh)) - Math.round(rh / 2);

  const clampedLeft = Math.max(0, Math.min(left, CANVAS_W - 1));
  const clampedTop  = Math.max(0, Math.min(top,  CANVAS_H - 1));

  composites.push({ input: rotated, left: clampedLeft, top: clampedTop, blend: 'over' });

  if (composites.length === 100 || i === STAMP_COUNT - 1) {
    canvas = await sharp(canvas).composite(composites).png().toBuffer();
    composites.length = 0;
    process.stdout.write(`  stamps: ${i + 1}/${STAMP_COUNT}\r`);
  }
}

// ---------------------------------------------------------------------------
// Slice into tiles and write
// ---------------------------------------------------------------------------

mkdirSync(ASSETS_DIR, { recursive: true });
console.log(`\n\nSlicing into ${TILE_COUNT} tiles…`);

for (let i = 0; i < TILE_COUNT; i++) {
  const tileBuffer = await sharp(canvas)
    .extract({ left: 0, top: i * TILE_H, width: CANVAS_W, height: TILE_H })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();

  const outFile = join(ASSETS_DIR, `composite-heap-${i}.png`);
  writeFileSync(outFile, tileBuffer);
  console.log(`  ✅ composite-heap-${i}.png  (${(tileBuffer.length / 1024).toFixed(0)} KB)`);
}

// ---------------------------------------------------------------------------
// Emit heapTileUrls.ts — explicit ?url imports for Vite
// ---------------------------------------------------------------------------

const urlLines = [
  `// AUTO-GENERATED by scripts/gen-heap-texture.mjs — do not edit by hand.`,
  `// Re-run the script after changing TILE_COUNT in sprite-config.mjs.`,
  ``,
];

for (let i = 0; i < TILE_COUNT; i++) {
  urlLines.push(`import tile${i}Url from '../assets/composite-heap-${i}.png?url';`);
}

urlLines.push(``);
urlLines.push(`export const HEAP_TILE_COUNT = ${TILE_COUNT};`);
urlLines.push(``);
urlLines.push(`/** Resolved asset URLs for all heap tiles, indexed 0…HEAP_TILE_COUNT-1. */`);
urlLines.push(`export const HEAP_TILE_URLS: string[] = [`);
for (let i = 0; i < TILE_COUNT; i++) {
  urlLines.push(`  tile${i}Url,`);
}
urlLines.push(`];`);
urlLines.push(``);

writeFileSync(OUT_URLS, urlLines.join('\n'), 'utf8');
console.log(`\n✅ Wrote ${OUT_URLS}`);
console.log(`   TILE_COUNT=${TILE_COUNT}, STAMP_COUNT=${STAMP_COUNT}`);
