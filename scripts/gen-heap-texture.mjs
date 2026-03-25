/**
 * gen-heap-texture.mjs
 *
 * Generates public/composite-heap.png — a 960×1024 tiling texture made by
 * randomly stamping all 25 heap SVGs onto a dark background.
 * Each of the STAMP_COUNT stamps picks a random SVG, position, and rotation.
 * Later stamps render on top of earlier ones, creating natural layering depth.
 *
 * Run: node scripts/gen-heap-texture.mjs
 * Output is committed to source control and loaded by BootScene at runtime.
 */

import sharp from 'sharp';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs';
import { join, basename, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SVG_DIR   = join(__dirname, '..', 'src', 'svgs');
const OUT_FILE  = join(__dirname, '..', 'src', 'assets', 'composite-heap.png');

/** Canvas dimensions — full world width, power-of-two height for seamless tiling */
const CANVAS_W = 960;
const CANVAS_H = 1024;

/** Longest side target for each stamped SVG (same as game TARGET_PX) */
const TARGET_PX = 96;

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
// Dimension parsing (mirrors gen-heap-defs.mjs)
// ---------------------------------------------------------------------------

function parseDimensions(svgText) {
  const vb = svgText.match(/viewBox\s*=\s*["']([^"']+)["']/i);
  if (vb) {
    const parts = vb[1].trim().split(/[\s,]+/);
    if (parts.length >= 4) {
      const w = parseFloat(parts[2]);
      const h = parseFloat(parts[3]);
      if (w > 0 && h > 0) return { w, h };
    }
  }
  const wAttr = svgText.match(/\bwidth\s*=\s*["']([0-9.]+)/i);
  const hAttr = svgText.match(/\bheight\s*=\s*["']([0-9.]+)/i);
  if (wAttr && hAttr) {
    const w = parseFloat(wAttr[1]);
    const h = parseFloat(hAttr[1]);
    if (w > 0 && h > 0) return { w, h };
  }
  return { w: 100, h: 100 };
}

function scaleTo(w, h, target) {
  const scale = target / Math.max(w, h);
  return {
    width:  Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

// ---------------------------------------------------------------------------
// Load and rasterise all SVGs
// ---------------------------------------------------------------------------

const svgFiles = readdirSync(SVG_DIR)
  .filter(f => extname(f).toLowerCase() === '.svg')
  .sort();

console.log(`Found ${svgFiles.length} SVGs — rasterising…`);

const items = await Promise.all(svgFiles.map(async filename => {
  const svgPath = join(SVG_DIR, filename);
  const svgText = readFileSync(svgPath, 'utf8');
  const { w, h } = parseDimensions(svgText);
  const { width, height } = scaleTo(w, h, TARGET_PX);
  const pngBuffer = await sharp(Buffer.from(svgText))
    .resize(width, height)
    .png()
    .toBuffer();
  console.log(`  ✓ ${basename(filename)} → ${width}×${height}px`);
  return { filename, pngBuffer, width, height };
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

  // sharp supports up to ~1000 composites per call but we'll batch in groups
  // to avoid memory pressure
  if (composites.length === 100 || i === STAMP_COUNT - 1) {
    canvas = await sharp(canvas).composite(composites).png().toBuffer();
    composites.length = 0;
    process.stdout.write(`  stamps: ${i + 1}/${STAMP_COUNT}\r`);
  }
}

// ---------------------------------------------------------------------------
// Write output
// ---------------------------------------------------------------------------

mkdirSync(join(__dirname, '..', 'public'), { recursive: true });
// Compress with pngquant-style quantisation via sharp
const compressed = await sharp(canvas)
  .png({ compressionLevel: 9, palette: false })
  .toBuffer();

writeFileSync(OUT_FILE, compressed);
console.log(`\n\n✅ Wrote ${OUT_FILE}`);

const stats = await sharp(compressed).metadata();
console.log(`   Size: ${stats.width}×${stats.height}px, ${(compressed.length / 1024).toFixed(0)} KB`);
