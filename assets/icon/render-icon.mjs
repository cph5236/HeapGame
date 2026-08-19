// App icon renderer.
// Run from repo root:  node assets/icon/render-icon.mjs
//
// Composition: the trash-bag character standing on the summit of a dark junk-heap
// silhouette, lit from behind by the sunset glow of the play-listing design system.
// The bag sprite is the real in-game art (src/sprites/player/trashbag.png), so the
// icon and the thing you control are the same character.
//
// Outputs (all consumed downstream, none are decoration):
//   assets/icon-background.png  1024  adaptive-icon background layer (sky, full bleed)
//   assets/icon-foreground.png  1024  adaptive-icon foreground layer (heap + bag, alpha)
//   assets/icon-only.png        1024  the two flattened — legacy square/round launcher icon
//   android/.../graphics/icon/1.png  512  Play Store listing icon (opaque, square)
//
// After running this, regenerate the mipmaps:  npx @capacitor/assets generate --android
//
// NOTE ON SAFE AREA: mipmap-anydpi-v26/ic_launcher.xml insets both layers by 16.7%,
// which lands the artwork exactly on Android's standard 72dp circular mask. So this
// 1024 canvas *is* the visible circle — keep the subject inside the middle ~80% and
// let the heap bleed off the bottom edge, where the mask clips it cleanly.
import pw from 'playwright';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const { chromium } = pw;

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '../..');
const S = 1024;

const img = (p) => `data:image/png;base64,${fs.readFileSync(p).toString('base64')}`;
const BAG = img(`${ROOT}/src/sprites/player/trashbag.png`);

// Stars, confined to the darker upper corners so they never fight the glow.
function stars(n, seed = 5) {
  let s = seed, out = '';
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < n; i++) {
    const x = rnd() * S, y = rnd() * S * 0.5;
    // fade out toward the centre, where the sun glow washes them out anyway
    const d = Math.hypot(x - S / 2, y - S * 0.40) / S;
    const o = Math.min(0.55, Math.max(0, d - 0.18)) * (rnd() * 0.8 + 0.4);
    if (o < 0.04) continue;
    out += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(rnd() * 2.6 + 1).toFixed(1)}" fill="#fff" opacity="${o.toFixed(2)}"/>`;
  }
  return out;
}

// The heap silhouette. A base mound plus scattered crates, planks, barrels and a tyre
// — all one fill, so they union into a single junky outline rather than reading as a
// mountain. Apex at (512, 620), where the bag's feet land; sides and bottom overshoot
// the canvas so the circular mask never reveals an edge.
const MOUND = [
  [-80, 1090], [10, 930], [120, 890], [230, 852], [330, 806], [420, 758], [512, 700],
  [604, 758], [694, 806], [794, 852], [904, 890], [1014, 930], [1104, 1090],
];
// x, y, w, h, rotation° — debris straddling the mound edge, so the skyline breaks up
// into junk instead of reading as a clean slope. Kept clear of the apex: the peak has
// to stay sharp or the bag reads as standing on a wall.
const DEBRIS = [
  // left flank, below the apex down to the bottom corner
  [400, 724, 74, 52, -13], [310, 772, 110, 22, -20], [240, 816, 72, 52, -9],
  [130, 864, 96, 20, -13], [30, 908, 66, 52, -6],
  // right flank
  [552, 730, 72, 52, 15], [614, 778, 112, 22, 20], [712, 824, 74, 52, 10],
  [802, 868, 88, 20, 13], [912, 912, 66, 52, 6],
];
const TYRES = [[180, 880, 34], [962, 920, 30]];

const rect = ([x, y, w, h, deg]) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" transform="rotate(${deg} ${x + w / 2} ${y + h / 2})"/>`;
const heapShapes = [
  `<path d="M ${MOUND.map((p) => p.join(' ')).join(' L ')} Z"/>`,
  ...DEBRIS.map(rect),
  ...TYRES.map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`),
].join('');

// ---- sky variants -------------------------------------------------------------
// The subject never changes; only what sits behind it. Render them side by side with
//   node assets/icon/render-icon.mjs --variants
// and set SKY below to whichever wins.
const SKIES = {
  // radial sun core with faint conic rays
  sunburst: {
    css: `
.sky{position:absolute;inset:0;background:
  radial-gradient(circle at 50% 44%, #ffc247 0%, #ff9922 17%, #f2701f 31%, #b8482a 48%,
    #5f2740 68%, #241340 84%, #140d24 100%)}
.rays{position:absolute;left:50%;top:44%;width:1700px;height:1700px;transform:translate(-50%,-50%);
  background:repeating-conic-gradient(from 8deg at 50% 50%,
    rgba(255,228,170,.075) 0deg 7deg, rgba(255,228,170,0) 7deg 26deg);
  -webkit-mask-image:radial-gradient(circle,rgba(0,0,0,.75) 4%,transparent 46%);
  mask-image:radial-gradient(circle,rgba(0,0,0,.75) 4%,transparent 46%)}
.core{position:absolute;left:50%;top:44%;width:760px;height:760px;transform:translate(-50%,-50%);
  background:radial-gradient(circle,rgba(255,236,190,.75),rgba(255,190,90,.28) 42%,transparent 68%)}
.vig{position:absolute;inset:0;
  background:radial-gradient(circle at 50% 44%, transparent 52%, rgba(14,8,26,.55) 100%)}`,
    html: `<div class="sky"></div><div class="rays"></div><div class="core"></div>
      __STARS__<div class="vig"></div>`,
  },

  // the in-game sky: night above, sunset band burning through behind the summit
  dusk: {
    css: `
.sky{position:absolute;inset:0;background:linear-gradient(180deg,
  #0b0b1e 0%, #16112e 18%, #2a1740 34%, #5a2c46 48%, #b8482a 60%,
  #f2701f 69%, #ff9d33 76%, #c25226 88%, #43203c 100%)}
.core{position:absolute;left:50%;top:60%;width:900px;height:520px;transform:translate(-50%,-50%);
  background:radial-gradient(ellipse,rgba(255,226,160,.55),rgba(255,180,80,.2) 45%,transparent 70%)}
.vig{position:absolute;inset:0;
  background:radial-gradient(circle at 50% 52%, transparent 54%, rgba(10,6,22,.5) 100%)}`,
    html: `<div class="sky"></div><div class="core"></div>__STARS__<div class="vig"></div>`,
  },

  // flat graphic duotone — no gradient behind the subject, maximum small-size punch
  duotone: {
    css: `
.sky{position:absolute;inset:0;background:linear-gradient(180deg,
  #1b1030 0%, #1b1030 30%, #6b2a34 42%, #ff8c1a 53%, #ff8c1a 100%)}
.vig{position:absolute;inset:0;
  background:radial-gradient(circle at 50% 46%, transparent 56%, rgba(12,6,24,.45) 100%)}`,
    html: `<div class="sky"></div>__STARS__<div class="vig"></div>`,
  },

  // hard-edged sun disc behind the peak, night sky around it
  sundisc: {
    css: `
.sky{position:absolute;inset:0;background:linear-gradient(180deg,
  #0a0a1e 0%, #191036 34%, #33184a 62%, #4a1f45 100%)}
.disc{position:absolute;left:50%;top:47%;width:660px;height:660px;transform:translate(-50%,-50%);
  border-radius:50%;background:linear-gradient(180deg,#ffd166 0%,#ff9922 46%,#f2601c 100%);
  box-shadow:0 0 90px 30px rgba(255,140,40,.45)}
.vig{position:absolute;inset:0;
  background:radial-gradient(circle at 50% 47%, transparent 58%, rgba(8,5,20,.5) 100%)}`,
    html: `<div class="sky"></div><div class="disc"></div>__STARS__<div class="vig"></div>`,
  },

  // sun disc sliced by retro horizon bands
  banded: {
    css: `
.sky{position:absolute;inset:0;background:linear-gradient(180deg,
  #0a0a1e 0%, #1c1038 36%, #3a1a4c 66%, #55204a 100%)}
.disc{position:absolute;left:50%;top:47%;width:680px;height:680px;transform:translate(-50%,-50%);
  border-radius:50%;background:linear-gradient(180deg,#ffe08a 0%,#ffa62b 44%,#f2601c 100%);
  box-shadow:0 0 90px 26px rgba(255,140,40,.4);
  -webkit-mask-image:linear-gradient(180deg,#000 0 54%,transparent 54% 57%,#000 57% 68%,
    transparent 68% 72%,#000 72% 80%,transparent 80% 86%,#000 86% 92%,transparent 92%);
  mask-image:linear-gradient(180deg,#000 0 54%,transparent 54% 57%,#000 57% 68%,
    transparent 68% 72%,#000 72% 80%,transparent 80% 86%,#000 86% 92%,transparent 92%)}
.vig{position:absolute;inset:0;
  background:radial-gradient(circle at 50% 47%, transparent 58%, rgba(8,5,20,.5) 100%)}`,
    html: `<div class="sky"></div><div class="disc"></div>__STARS__<div class="vig"></div>`,
  },
};
const SKY = process.env.ICON_SKY || 'sundisc';

// One composition, two toggleable layers. `sky` alone is the adaptive background,
// `subject` alone (rendered with omitBackground) is the adaptive foreground, and both
// together are the flattened launcher / store icon — so the layers can never drift.
const compose = ({ sky, subject, variant = SKY }) => `<!doctype html><html><head><meta charset="utf8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${S}px;height:${S}px;overflow:hidden;background:transparent}
.stage{position:relative;width:${S}px;height:${S}px;overflow:hidden}
${SKIES[variant].css}
/* --- subject --- */
/* the warm halo (stacked drop-shadows hug the sprite's alpha) is what stops a black
   bag from dissolving into a black heap at launcher sizes */
.bag{position:absolute;left:50%;top:728px;width:430px;transform:translate(-50%,-79%);
  filter:
    drop-shadow(0 0 14px rgba(255,200,110,.9))
    drop-shadow(0 0 28px rgba(255,140,40,.6))
    drop-shadow(0 10px 16px rgba(30,8,10,.5))}
</style></head><body>
<div class="stage">
  ${sky ? SKIES[variant].html.replace('__STARS__',
    `<svg style="position:absolute;inset:0" width="${S}" height="${S}">${stars(120)}</svg>`) : ''}
  ${subject ? `
  <svg style="position:absolute;inset:0" width="${S}" height="${S}">
    <defs><g id="heap">${heapShapes}</g></defs>
    <!-- rim light: the same silhouette offset up-left, showing only as a lit edge -->
    <use href="#heap" x="-6" y="-7" fill="#ff9d3c" opacity=".5"/>
    <use href="#heap" fill="#150f22"/>
  </svg>
  <img class="bag" src="${BAG}"/>` : ''}
</div></body></html>`;

// ---- render ----
const shoot = async (browser, html, out, { alpha = false, size = S } = {}) => {
  const page = await browser.newPage({
    viewport: { width: S, height: S },
    deviceScaleFactor: size / S,
  });
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForTimeout(120);
  await page.screenshot({ path: out, omitBackground: alpha });
  await page.close();
  console.log('rendered', path.relative(ROOT, out), `${size}x${size}`);
};

const browser = await chromium.launch();

// --variants: render every sky side by side for comparison, write nothing else
if (process.argv.includes('--variants')) {
  const out = process.env.ICON_VARIANT_DIR || `${ROOT}/.icon-variants`;
  fs.mkdirSync(out, { recursive: true });
  for (const name of Object.keys(SKIES)) {
    await shoot(browser, compose({ sky: true, subject: true, variant: name }),
      `${out}/${name}.png`, { size: 512 });
  }
  await browser.close();
  process.exit(0);
}

const flat = compose({ sky: true, subject: true });

await shoot(browser, compose({ sky: true, subject: false }), `${ROOT}/assets/icon-background.png`);
await shoot(browser, compose({ sky: false, subject: true }), `${ROOT}/assets/icon-foreground.png`, { alpha: true });
await shoot(browser, flat, `${ROOT}/assets/icon-only.png`);

const LISTING = `${ROOT}/android/app/src/main/play/listings/en-US/graphics/icon`;
fs.mkdirSync(LISTING, { recursive: true });
await shoot(browser, flat, `${LISTING}/1.png`, { size: 512 });

await browser.close();
