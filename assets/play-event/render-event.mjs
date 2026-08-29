// Play Console promotional-content (LiveOps event) asset renderer.
// Run from repo root:  node assets/play-event/render-event.mjs
//
// Outputs 1920x1080 (16:9) key art for the "Grand Opening: Founder's Scrap Drop"
// event into assets/play-event/:
//
//   grand-opening-clean.png/.jpg  — the Play Console submission. Zero text.
//   grand-opening-safezone.png    — clean art + safe-zone guides. Debug only, never uploaded.
//   grand-opening-code.png        — code-stamped variant for itch/social/Discord. NOT for Play.
//
// Google's primary-image rules (support.google.com/googleplay/android-developer/answer/12929944):
//   - 1920x1080, 16:9, JPG or 24-bit PNG
//   - safe zone: 15% top, 20% bottom, 10% each side; keep the focal point centred in it
//   - NO text of any kind (logos, slogans, event names) — the message goes in the tagline
//   - no border frames, no shapes resembling buttons/tap targets
// The clean variant is built to satisfy all of the above by construction.
//
// Art is pulled from the real game so the event reads as the same product:
// the packed-junk composite texture, the trash-bag player sprite, the heap's
// stepped silhouette and its two-tone outline + rim-light treatment. The sky
// matches the store-listing design system (assets/play-listing/render.mjs).
import pw from 'playwright';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const { chromium } = pw;

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '../..');
const LISTING = path.resolve(ROOT, 'assets/play-listing');

const b64 = (p) => fs.readFileSync(p).toString('base64');
const font = (p) => `data:font/ttf;base64,${b64(p)}`;
const img = (p) => `data:image/png;base64,${b64(p)}`;

const ANTON = font(`${LISTING}/fonts/Anton.ttf`);
const ARCHIVO = font(`${LISTING}/fonts/ArchivoBlack.ttf`);
// Four distinct 960x1024 packed-junk tiles. Laid out as a 2x2 grid rather than
// an SVG <pattern>: a single repeating tile puts an obvious seam straight down
// the middle of a 1920-wide canvas, whereas four different tiles break the repeat.
const JUNK = [0, 1, 2, 3].map((i) => img(`${ROOT}/src/assets/composite-heap-${i}.png`));
const BAG = img(`${ROOT}/src/sprites/player/trashbag.png`);    // 174x197 player
const EN = `${ROOT}/src/sprites/Enemies`;
const VULTURE_L = img(`${EN}/vulture/vulture-fly-left.png`);    // 4 frames, 64x43
const VULTURE_R = img(`${EN}/vulture/vulture-fly-right.png`);   // 4 frames, 64x42
const RAT = img(`${EN}/Rat/rat.png`);                          // 3x4 sheet, 32x32

const W = 1920, H = 1080;

// Safe zone: 15% top, 20% bottom, 10% sides.
const SAFE = { x: W * 0.10, y: H * 0.15, w: W * 0.80, h: H * 0.65 };
const SAFE_CX = SAFE.x + SAFE.w / 2;   // 960
const SAFE_CY = SAFE.y + SAFE.h / 2;   // 513

// Palette lifted from the game (HeapChunkRenderer) + the listing design system.
const OUTLINE_DARK = '#241307';
const OUTLINE_WARM = '#7c4a23';
const RIM = 'rgb(235,208,162)';
const ORANGE = '#ff9922';

const FONTCSS = `
@font-face{font-family:'Anton';src:url('${ANTON}') format('truetype');}
@font-face{font-family:'Archivo';src:url('${ARCHIVO}') format('truetype');}
`;

/** Deterministic RNG so the art is byte-stable across re-renders. */
function rng(seed) {
  let s = seed;
  return () => (s = (s * 9301 + 49297) % 233280) / 233280;
}

function starField(n, seed) {
  const rnd = rng(seed);
  let out = '';
  for (let i = 0; i < n; i++) {
    const x = rnd() * W, y = rnd() * (H * 0.55);
    const r = rnd() * 1.9 + 0.5, o = rnd() * 0.5 + 0.15;
    out += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(1)}" fill="#fff" opacity="${o.toFixed(2)}"/>`;
  }
  return out;
}

// ---- heap silhouette -------------------------------------------------------
// The game's heap edge is a stepped, axis-aligned staircase (it comes from
// scanline slabs), so the key art mimics that instead of a smooth mound.

const STEP_W = 64;   // step width  (px)
const STEP_H = 32;   // step height quantum (px)

/** Skewed falloff — steeper on one flank than the other, so the mound reads as a
 *  dumped pile rather than a symmetric pyramid. */
function flank(dx, spread, power) {
  return Math.cos(Math.min(1, Math.abs(dx) / spread) * Math.PI / 2) ** power;
}

/** Column top-Y values for a mound peaking at peakX, quantised to STEP_H. */
function heapTops(peakX, seed) {
  const rnd = rng(seed);
  const cols = Math.ceil(W / STEP_W) + 1;
  // A secondary shoulder off to one side breaks the single-summit symmetry.
  const shoulderX = peakX - W * 0.29;
  const tops = [];
  for (let i = 0; i < cols; i++) {
    const cx = i * STEP_W + STEP_W / 2;
    const dx = cx - peakX;
    // asymmetric main mass: gentler left flank, steeper right flank
    const main = flank(dx, dx < 0 ? W * 0.62 : W * 0.44, dx < 0 ? 1.25 : 1.9);
    const shoulder = flank(cx - shoulderX, W * 0.2, 2.2) * 0.34;
    // Floor the falloff so the tails stay a substantial pile instead of thinning
    // to nothing — a hard clamp lower down just produces dead-flat shelves.
    const lift = Math.max(0.42, main, shoulder * 0.92 + main * 0.55);
    // low-frequency roll on top of the profile, then per-column chunkiness
    const roll = Math.sin(cx / 168 + 1.7) * 0.035 + Math.sin(cx / 61) * 0.018;
    const jitter = (rnd() - 0.5) * STEP_H * 3.4;
    // baseline sits below the frame so the pile always covers the bottom band
    const y = H * 1.04 - (lift + roll) * H * 0.50 + jitter;
    tops.push(Math.round(Math.min(y, H * 0.97) / STEP_H) * STEP_H);
  }
  return tops;
}

/** Closed staircase path for the filled mound. */
function heapFillPath(tops) {
  let d = `M -20 ${H + 20} L -20 ${tops[0]}`;
  for (let i = 0; i < tops.length; i++) {
    const x0 = i * STEP_W;
    d += ` L ${x0} ${tops[i]} L ${x0 + STEP_W} ${tops[i]}`;
  }
  d += ` L ${W + 20} ${tops[tops.length - 1]} L ${W + 20} ${H + 20} Z`;
  return d;
}

/** Only the horizontal (up-facing) segments — these take the rim light. */
function heapRimPath(tops) {
  let d = '';
  for (let i = 0; i < tops.length; i++) {
    const x0 = i * STEP_W;
    d += ` M ${x0} ${tops[i]} L ${x0 + STEP_W} ${tops[i]}`;
  }
  return d.trim();
}

// ---- scrap coins -----------------------------------------------------------
/** A Scrap coin. Struck metal, not a bubble: it gets a visible edge thickness,
 *  a milled rim and a hard specular notch, which is what separates "coin" from
 *  "floating sphere" at a glance. `squash` narrows it for coins caught mid-spin.
 *  No stamped glyph — a number or letter would count as text in the image. */
function coin(x, y, r, o = 1, squash = 1, tilt = 0) {
  const rx = Math.max(r * squash, r * 0.16);
  const milling = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    milling.push(`M ${x + c * rx * 0.99} ${y + s * r * 0.99} L ${x + c * rx * 0.82} ${y + s * r * 0.82}`);
  }
  return `<g opacity="${o}" transform="rotate(${tilt} ${x} ${y})">
    <!-- struck edge: the coin's thickness, offset down so it reads as solid -->
    <ellipse cx="${x + rx * 0.1}" cy="${y + r * 0.2}" rx="${rx}" ry="${r}" fill="#7d4f0d"/>
    <ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${r}" fill="#c98b1a"/>
    <ellipse cx="${x}" cy="${y - r * 0.04}" rx="${rx * 0.86}" ry="${r * 0.86}" fill="url(#gold)"/>
    <path d="${milling.join(' ')}" stroke="#a8700f" stroke-width="${Math.max(0.9, r * 0.075)}"
      opacity="0.5" fill="none"/>
    <ellipse cx="${x}" cy="${y - r * 0.04}" rx="${rx * 0.58}" ry="${r * 0.58}"
      fill="none" stroke="#a8700f" stroke-width="${Math.max(1, r * 0.09)}" opacity="0.45"/>
    <ellipse cx="${x - rx * 0.34}" cy="${y - r * 0.4}" rx="${rx * 0.24}" ry="${r * 0.13}"
      fill="#fff8dd" opacity="0.95" transform="rotate(-32 ${x - rx * 0.34} ${y - r * 0.4})"/>
  </g>`;
}

/** Coins erupting from the bag. Deliberately NOT an even halo — an evenly-spaced
 *  ring of discs in empty sky reads as bubbles. This is a tight directional spray
 *  concentrated at the mouth, with a handful of strays and several coins spilling
 *  down onto the junk so they sit in the world rather than hovering over it. */
function coinBurst(cx, cy, seed) {
  const rnd = rng(seed);
  const specs = [
    // [angle deg, distance, radius] — inner arc, held well clear of the bag so
    // the player silhouette stays readable
    [-150, 176, 26], [-124, 158, 22], [-102, 190, 29], [-78, 162, 27],
    [-54, 184, 24], [-30, 168, 21],
    // main body of the spray
    [-164, 268, 22], [-140, 296, 19], [-116, 262, 25], [-92, 304, 21],
    [-68, 274, 23], [-44, 300, 18], [-20, 266, 20],
    // outer arc
    [-156, 396, 17], [-132, 428, 15], [-108, 392, 19], [-84, 436, 16],
    [-60, 400, 18], [-36, 424, 14], [-12, 388, 16],
    // strays at the edge of the throw
    [-148, 530, 13], [-96, 552, 15], [-46, 520, 12], [-8, 486, 11],
  ];
  return specs.map(([deg, dist, r]) => {
    const a = (deg + (rnd() - 0.5) * 8) * Math.PI / 180;
    const x = cx + Math.cos(a) * dist * 1.7;
    const y = cy + Math.sin(a) * dist * 0.72;
    const far = Math.min(1, dist / 550);
    const squash = rnd() < 0.34 ? 0.28 + rnd() * 0.38 : 1;
    return coin(x, y, r, 1 - far * 0.24, squash, (rnd() - 0.5) * 55);
  }).join('');
}

/** Crop one frame out of a sprite sheet via a nested-SVG viewBox, scaled up and
 *  kept pixel-crisp (these are 32px pixel-art sheets). */
function sheetFrame({ href, sheetW, sheetH, fw, fh, frame, x, y, scale, flip = false }) {
  const cols = Math.round(sheetW / fw);
  const fx = (frame % cols) * fw;
  const fy = Math.floor(frame / cols) * fh;
  const t = flip ? ` transform="translate(${2 * fx + fw} 0) scale(-1 1)"` : '';
  return `<svg x="${x}" y="${y}" width="${fw * scale}" height="${fh * scale}"
    viewBox="${fx} ${fy} ${fw} ${fh}">
    <image href="${href}" width="${sheetW}" height="${sheetH}"
      style="image-rendering:pixelated"${t}/>
  </svg>`;
}

const vulture = (x, y, scale, frame, facing = 'left') => sheetFrame({
  href: facing === 'left' ? VULTURE_L : VULTURE_R,
  sheetW: 256, sheetH: facing === 'left' ? 43 : 42,
  fw: 64, fh: facing === 'left' ? 43 : 42, frame, x, y, scale,
});

// rat sheet rows: 0 idle, 1 walk-right, 2 walk-down, 3 walk-left
const rat = (x, y, scale, frame) => sheetFrame({
  href: RAT, sheetW: 96, sheetH: 128, fw: 32, fh: 32, frame, x, y, scale,
});

/** Coins come to rest on the junk itself. Without these the whole burst floats
 *  in open sky and stops reading as objects with weight. */
function coinsOnSteps(tops, cols, seed) {
  const rnd = rng(seed);
  return cols.map(([col, r]) => {
    const i = Math.max(0, Math.min(tops.length - 1, col));
    const x = i * STEP_W + STEP_W / 2 + (rnd() - 0.5) * STEP_W * 0.7;
    // sunk very slightly into the surface so they sit on it, not above it
    return coin(x, tops[i] - r * 0.72, r, 1, rnd() < 0.4 ? 0.55 + rnd() * 0.3 : 1,
      (rnd() - 0.5) * 26);
  }).join('');
}

/** Stand a rat on top of a given heap column so it never floats or sinks. */
function ratOnStep(tops, col, scale, frame) {
  const i = Math.max(0, Math.min(tops.length - 1, col));
  const x = i * STEP_W + STEP_W / 2 - (32 * scale) / 2;
  return rat(x, tops[i] - 32 * scale + 4, scale, frame);
}

/** Packed-junk backing: the four composite tiles laid edge to edge, each
 *  slightly overscanned and alternately mirrored so no tile edge lines up with
 *  its neighbour's. Covers 1920x1080 with no repeated tile. */
function junkFill() {
  const TW = 960, TH = 1024, OVER = 8;   // overscan hides the hairline joins
  const cells = [
    [0, 0, 0, false], [1, 1, 0, true],
    [2, 0, 1, true], [3, 1, 1, false],
  ];
  return cells.map(([tile, col, row, flip]) => {
    const x = col * TW - OVER, y = row * TH - OVER + H * 0.06;
    const w = TW + OVER * 2, h = TH + OVER * 2;
    const t = flip ? ` transform="translate(${2 * x + w} 0) scale(-1 1)"` : '';
    return `<image href="${JUNK[tile]}" x="${x}" y="${y}" width="${w}" height="${h}"
      preserveAspectRatio="none"${t}/>`;
  }).join('');
}

// ---- the shared key-art scene ---------------------------------------------
function keyArt({ peakX, bagX }) {
  const tops = heapTops(peakX, 1337);
  const bagCol = Math.round((bagX - STEP_W / 2) / STEP_W);
  const bagY = tops[Math.max(0, Math.min(tops.length - 1, bagCol))];
  const bagH = 156, bagW = bagH * (174 / 197);

  return `
  <svg class="art" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="#070714"/>
        <stop offset="22%"  stop-color="#101030"/>
        <stop offset="45%"  stop-color="#241645"/>
        <stop offset="66%"  stop-color="#4e2947"/>
        <stop offset="84%"  stop-color="#a8412a"/>
        <stop offset="100%" stop-color="#e8622a"/>
      </linearGradient>
      <radialGradient id="sun" cx="50%" cy="50%" r="50%">
        <stop offset="0%"   stop-color="rgba(255,150,40,0.42)"/>
        <stop offset="55%"  stop-color="rgba(255,120,30,0.14)"/>
        <stop offset="100%" stop-color="rgba(255,120,30,0)"/>
      </radialGradient>
      <radialGradient id="gold" cx="38%" cy="32%" r="72%">
        <stop offset="0%"   stop-color="#ffe07a"/>
        <stop offset="58%"  stop-color="#ffc63a"/>
        <stop offset="100%" stop-color="#e39d1e"/>
      </radialGradient>
      <filter id="coinGlow" x="-120%" y="-120%" width="340%" height="340%">
        <feGaussianBlur stdDeviation="9" result="b"/>
        <feFlood flood-color="#ffb43c" flood-opacity="0.55"/>
        <feComposite in2="b" operator="in" result="g"/>
        <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <filter id="heapHalo" x="-15%" y="-30%" width="130%" height="160%">
        <feDropShadow dx="0" dy="0" stdDeviation="26" flood-color="#000" flood-opacity="0.55"/>
      </filter>
      <filter id="bagShadow" x="-60%" y="-60%" width="220%" height="220%">
        <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity="0.6"/>
      </filter>
      <clipPath id="heapClip"><path d="${heapFillPath(tops)}"/></clipPath>
    </defs>

    <rect width="${W}" height="${H}" fill="url(#sky)"/>
    ${starField(150, 7)}
    <ellipse cx="${peakX}" cy="${H * 0.86}" rx="${W * 0.55}" ry="${H * 0.5}" fill="url(#sun)"/>

    <!-- heap: junk texture clipped to the stepped silhouette -->
    <g filter="url(#heapHalo)">
      <path d="${heapFillPath(tops)}" fill="${OUTLINE_DARK}"/>
    </g>
    <g clip-path="url(#heapClip)">
      ${junkFill()}
      <!-- ambient occlusion: dark inner rim, widest/faintest first -->
      <path d="${heapFillPath(tops)}" fill="none" stroke="rgb(8,6,3)" stroke-width="88" opacity="0.06"/>
      <path d="${heapFillPath(tops)}" fill="none" stroke="rgb(8,6,3)" stroke-width="60" opacity="0.08"/>
      <path d="${heapFillPath(tops)}" fill="none" stroke="rgb(8,6,3)" stroke-width="36" opacity="0.11"/>
      <path d="${heapFillPath(tops)}" fill="none" stroke="rgb(8,6,3)" stroke-width="20" opacity="0.15"/>
      <path d="${heapFillPath(tops)}" fill="none" stroke="rgb(8,6,3)" stroke-width="10" opacity="0.22"/>
      <!-- night grade so the junk sits in the sunset, not on top of it; kept
           light enough that the junk keeps its colour and stays readable -->
      <rect width="${W}" height="${H}" fill="#1c1030" opacity="0.17"/>
      <rect width="${W}" height="${H}" fill="url(#sun)" opacity="0.42"/>
    </g>
    <!-- two-tone beveled outline: dark base, warmer brown inside it -->
    <path d="${heapFillPath(tops)}" fill="none" stroke="${OUTLINE_DARK}" stroke-width="16"
      stroke-linejoin="round" clip-path="url(#heapClip)"/>
    <path d="${heapFillPath(tops)}" fill="none" stroke="${OUTLINE_WARM}" stroke-width="7"
      stroke-linejoin="round" clip-path="url(#heapClip)"/>
    <!-- rim light on up-facing edges only -->
    <path d="${heapRimPath(tops)}" fill="none" stroke="${RIM}" stroke-width="3.4" opacity="0.8"/>

    <!-- vultures circling the summit: staggered size = depth, and they break up
         the empty upper sky the coin spray used to be doing badly -->
    ${vulture(bagX - 610, bagY - 430, 3.6, 1, 'right')}
    ${vulture(bagX + 392, bagY - 356, 2.7, 2, 'left')}
    ${vulture(bagX - 236, bagY - 336, 1.8, 0, 'left')}

    ${coinBurst(bagX, bagY - bagH * 0.5, 4242)}
    ${coinsOnSteps(tops, [
      [bagCol - 5, 18], [bagCol - 3, 13], [bagCol + 4, 17], [bagCol + 6, 12],
      [bagCol - 11, 16], [bagCol + 10, 14], [bagCol - 16, 12], [bagCol + 15, 13],
      [bagCol - 21, 11], [bagCol + 20, 12],
    ], 909)}

    <!-- rats working the slopes, planted on step tops -->
    ${ratOnStep(tops, bagCol - 7, 3.4, 4)}
    ${ratOnStep(tops, bagCol + 6, 2.9, 10)}

    <g filter="url(#bagShadow)">
      <image href="${BAG}" x="${bagX - bagW / 2}" y="${bagY - bagH + 6}"
        width="${bagW}" height="${bagH}"/>
    </g>
  </svg>`;
}

function page(inner, extraCss = '') {
  return `<!doctype html><html><head><meta charset="utf8"><style>
  ${FONTCSS}
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${W}px;height:${H}px;overflow:hidden;background:#070714}
  .stage{position:relative;width:${W}px;height:${H}px;font-family:'Archivo',sans-serif}
  .art{position:absolute;inset:0}
  ${extraCss}
  </style></head><body><div class="stage">${inner}</div></body></html>`;
}

// ---- variant 1: clean (the Play submission) --------------------------------
// Focal point (player + scrap burst) sits on the safe-zone centre. No text,
// no frame, no button-like shapes.
const CLEAN = { peakX: SAFE_CX, bagX: SAFE_CX };
const cleanHtml = page(keyArt(CLEAN));

// ---- variant 2: safe-zone check (debug, never uploaded) --------------------
const safezoneHtml = page(`${keyArt(CLEAN)}
  <svg class="art" width="${W}" height="${H}">
    <rect x="0" y="0" width="${W}" height="${H}" fill="#ff00aa" opacity="0.18"/>
    <rect x="${SAFE.x}" y="${SAFE.y}" width="${SAFE.w}" height="${SAFE.h}"
      fill="#66ff99" opacity="0.16" stroke="#00ffcc" stroke-width="3" stroke-dasharray="14 10"/>
    <circle cx="${SAFE_CX}" cy="${SAFE_CY}" r="10" fill="#00ffcc"/>
    <circle cx="${SAFE_CX}" cy="${SAFE_CY}" r="150" fill="none" stroke="#00ffcc"
      stroke-width="2" opacity="0.6"/>
  </svg>`);

// ---- variant 3: code-stamped (itch / social / Discord — NOT for Play) ------
// Peak shifts right so the left third carries the copy.
const CODE_ART = { peakX: W * 0.66, bagX: W * 0.68 };
const codeCss = `
  .scrim{position:absolute;left:0;top:0;bottom:0;width:52%;
    background:linear-gradient(90deg,rgba(6,6,18,.92) 0%,rgba(6,6,18,.78) 45%,rgba(6,6,18,0) 100%)}
  .copy{position:absolute;left:118px;top:196px;width:820px}
  .kicker{font-family:'Archivo';font-size:30px;letter-spacing:9px;color:#ffb648;
    text-transform:uppercase;opacity:.95;margin-bottom:18px}
  .head{font-family:'Anton';text-transform:uppercase;font-size:132px;line-height:.9;
    letter-spacing:1px;color:${ORANGE};
    text-shadow:0 6px 0 #7a2600,0 7px 0 #7a2600,6px 0 0 #7a2600,-5px 0 0 #7a2600,
      0 10px 28px rgba(0,0,0,.6),0 0 48px rgba(255,150,40,.28)}
  .chip{display:inline-block;margin-top:34px;padding:16px 34px;
    border:4px dashed rgba(255,190,90,.85);border-radius:10px;background:rgba(255,153,34,.1)}
  .chip .l{font-family:'Archivo';font-size:20px;letter-spacing:6px;color:#ffcf8a;
    text-transform:uppercase;display:block;margin-bottom:8px}
  .chip .c{font-family:'Anton';font-size:66px;letter-spacing:6px;color:#ffe9a8;line-height:.95;
    text-shadow:0 0 26px rgba(255,180,60,.5)}
  .where{font-family:'Archivo';font-size:25px;color:#e9dfff;margin-top:30px;opacity:.9}
  .where b{color:#ffd166;font-weight:400}
`;
const codeHtml = page(`${keyArt(CODE_ART)}
  <div class="scrim"></div>
  <div class="copy">
    <div class="kicker">Grand Opening</div>
    <div class="head">300 free<br>Scrap</div>
    <div class="chip"><span class="l">Redeem code</span><span class="c">HEAPDAY</span></div>
    <div class="where">In game: <b>Settings › Player › Redeem Code</b></div>
  </div>`, codeCss);

// ---- render ----------------------------------------------------------------
const browser = await chromium.launch();
const shoot = async (html, name, jpg = false) => {
  const p = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await p.setContent(html, { waitUntil: 'load' });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(220);
  await p.screenshot({ path: `${DIR}/${name}.png` });
  if (jpg) await p.screenshot({ path: `${DIR}/${name}.jpg`, type: 'jpeg', quality: 95 });
  await p.close();
  console.log('rendered', name, `${W}x${H}`, jpg ? '(png + jpg)' : '');
};

await shoot(cleanHtml, 'grand-opening-clean', true);
await shoot(safezoneHtml, 'grand-opening-safezone');
await shoot(codeHtml, 'grand-opening-code');
await browser.close();
