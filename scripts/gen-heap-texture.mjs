/**
 * gen-heap-texture.mjs
 *
 * Generates src/assets/composite-heap.png — a 960×1024 tiling texture made by
 * randomly stamping all sprite PNGs onto a dark background.
 * Each of the STAMP_COUNT stamps picks a random sprite, position, and rotation.
 * Later stamps render on top of earlier ones, creating natural layering depth.
 *
 * Run: node scripts/gen-heap-texture.mjs
 * Output is committed to source control and loaded by BootScene at runtime.
 */

import sharp from 'sharp';
import { writeFileSync, readdirSync, mkdirSync } from 'fs';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname   = dirname(fileURLToPath(import.meta.url));
const SPRITES_DIR = join(__dirname, '..', 'src', 'sprites');
const OUT_FILE    = join(__dirname, '..', 'src', 'assets', 'composite-heap.png');

/** Canvas dimensions — full world width, power-of-two height for seamless tiling */
const CANVAS_W = 960;
const CANVAS_H = 1024;

/** How many random stamps to composite onto the canvas */
const STAMP_COUNT = 1000;

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
// Load all sprite PNGs
// ---------------------------------------------------------------------------

const pngFiles = readdirSync(SPRITES_DIR)
  .filter(f => extname(f).toLowerCase() === '.png')
  .sort();

console.log(`Found ${pngFiles.length} sprites — loading…`);

const items = await Promise.all(pngFiles.map(async filename => {
  const pngPath = join(SPRITES_DIR, filename);
  const meta = await sharp(pngPath).metadata();
  const pngBuffer = await sharp(pngPath).png().toBuffer();
  console.log(`  ✓ ${filename}  (${meta.width}×${meta.height}px)`);
  return { filename, pngBuffer, width: meta.width, height: meta.height };
}));

// ---------------------------------------------------------------------------
// Build composite
// ---------------------------------------------------------------------------

console.log(`\nCompositing ${STAMP_COUNT} stamps onto ${CANVAS_W}×${CANVAS_H} canvas…`);

// Start with a dark background
let canvas = await sharp({
  create: {
    width:    CANVAS_W,
    height:   CANVAS_H,
    channels: 4,
    background: { r: 18, g: 20, b: 35, alpha: 1 },
  },
}).png().toBuffer();

// Accumulate all composites in one sharp call for efficiency
const composites = [];

for (let i = 0; i < STAMP_COUNT; i++) {
  const item = items[Math.floor(rand() * items.length)];

  // Random rotation in multiples of 15°
  const rotDeg = Math.floor(rand() * 24) * 15;

  // Rasterise with rotation — let sharp handle it, keeping full extent
  const rotated = await sharp(item.pngBuffer)
    .rotate(rotDeg, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const meta = await sharp(rotated).metadata();
  const rw = meta.width;
  const rh = meta.height;

  // Random position — allow items to hang over edges so borders look natural
  const left = Math.round(rand() * (CANVAS_W + rw)) - Math.round(rw / 2);
  const top  = Math.round(rand() * (CANVAS_H + rh)) - Math.round(rh / 2);

  // Clamp to canvas bounds (sharp requires non-negative offsets)
  const clampedLeft = Math.max(0, Math.min(left, CANVAS_W - 1));
  const clampedTop  = Math.max(0, Math.min(top,  CANVAS_H - 1));

  composites.push({
    input: rotated,
    left: clampedLeft,
    top:  clampedTop,
    blend: 'over',
  });

  // Batch in groups to avoid memory pressure
  if (composites.length === 100 || i === STAMP_COUNT - 1) {
    canvas = await sharp(canvas).composite(composites).png().toBuffer();
    composites.length = 0;
    process.stdout.write(`  stamps: ${i + 1}/${STAMP_COUNT}\r`);
  }
}

// ---------------------------------------------------------------------------
// Write output
// ---------------------------------------------------------------------------

mkdirSync(join(__dirname, '..', 'src', 'assets'), { recursive: true });
const compressed = await sharp(canvas)
  .png({ compressionLevel: 9, palette: false })
  .toBuffer();

writeFileSync(OUT_FILE, compressed);
console.log(`\n\n✅ Wrote ${OUT_FILE}`);

const stats = await sharp(compressed).metadata();
console.log(`   Size: ${stats.width}×${stats.height}px, ${(compressed.length / 1024).toFixed(0)} KB`);
