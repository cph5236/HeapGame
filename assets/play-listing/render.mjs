// Play Store listing asset renderer.
// Run from repo root:  node assets/play-listing/render.mjs
// Outputs 00-feature.png (1024x500) + 01..07 phone screenshots (1080x1920) into assets/play-listing/.
//
// Raw game captures live in assets/play-listing/raw/ (regenerate via `npm run scene-preview`).
// To add a new screenshot: drop the capture in raw/, add an entry to the `jobs` array.
import pw from 'playwright';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const { chromium } = pw;

const DIR = path.dirname(fileURLToPath(import.meta.url));
const b64 = (p) => fs.readFileSync(p).toString('base64');
const font = (p) => `data:font/ttf;base64,${b64(p)}`;
const img = (p) => `data:image/png;base64,${b64(p)}`;

const ANTON = font(`${DIR}/fonts/Anton.ttf`);
const ARCHIVO = font(`${DIR}/fonts/ArchivoBlack.ttf`);

const SHOTS = {
  game:    img(`${DIR}/raw/game.png`),
  score:   img(`${DIR}/raw/score.png`),
  custom:  img(`${DIR}/raw/custom.png`),
  upgrade: img(`${DIR}/raw/upgrade.png`),
  // live-play action captures (from device)
  climb1:  img(`${DIR}/raw/climb1.png`),   // 170 ft — beside the heap wall
  climb2:  img(`${DIR}/raw/climb2.png`),   // 437 ft — high in open sky
  place:   img(`${DIR}/raw/place.png`),    // 538 ft — PLACE moment
  salvage: img(`${DIR}/raw/salvage.png`),  // 175 ft — Box Spring GRAB
  enemy:   img(`${DIR}/raw/enemy.png`),    // 445 ft — rat + heap on left
};

const FONTCSS = `
@font-face{font-family:'Anton';src:url('${ANTON}') format('truetype');}
@font-face{font-family:'Archivo';src:url('${ARCHIVO}') format('truetype');}
`;

// ---- shared background: night-navy -> sunset sky, stars, soft glow ----
function starField(n, w, h, seed = 1) {
  let s = seed, out = '';
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < n; i++) {
    const x = rnd() * w, y = rnd() * (h * 0.6), r = rnd() * 2 + 0.6, o = rnd() * 0.5 + 0.15;
    out += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(1)}" fill="#fff" opacity="${o.toFixed(2)}"/>`;
  }
  return out;
}

// ---- PHONE SCREENSHOT (1080x1920) ----
function phone({ shot, kicker, headline, sub, ft }) {
  return `<!doctype html><html><head><meta charset="utf8"><style>
  ${FONTCSS}
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:1080px;height:1920px;overflow:hidden}
  .stage{position:relative;width:1080px;height:1920px;
    background:linear-gradient(178deg,#080816 0%,#0d0d24 26%,#231640 52%,#5a2c46 74%,#b8482a 90%,#e8622a 100%);
    font-family:'Archivo',sans-serif}
  .sky{position:absolute;inset:0}
  .glow{position:absolute;left:50%;top:-140px;transform:translateX(-50%);width:900px;height:900px;
    background:radial-gradient(circle,rgba(255,153,34,.16),transparent 62%);pointer-events:none}
  /* altitude rail */
  .rail{position:absolute;left:0;top:0;bottom:0;width:74px;
    border-right:2px solid rgba(255,170,68,.28);
    background:linear-gradient(90deg,rgba(8,8,20,.55),transparent)}
  .tick{position:absolute;right:0;height:2px;background:rgba(255,200,120,.35)}
  .tickL{width:34px} .tickS{width:18px;background:rgba(255,200,120,.18)}
  .ftbadge{position:absolute;left:14px;top:936px;font-family:'Archivo';text-align:left;
    filter:drop-shadow(0 2px 6px rgba(0,0,0,.65))}
  .ftbadge .mk{color:#ff9922;font-size:24px;line-height:1;text-shadow:0 0 14px rgba(255,150,40,.7)}
  .ftbadge .n{display:block;font-family:'Anton';font-size:62px;color:#ffb648;line-height:.9;letter-spacing:1px;
    text-shadow:0 3px 0 #5a1e00,0 0 22px rgba(255,150,40,.5)}
  .ftbadge .u{font-family:'Archivo';font-size:23px;color:#ffcf8a;letter-spacing:3px}
  .ftpoint{position:absolute;left:74px;top:966px;width:96px;height:3px;
    background:linear-gradient(90deg,rgba(255,153,34,.85),transparent)}
  /* caption */
  .cap{position:absolute;left:118px;right:56px;top:118px}
  .kicker{font-family:'Archivo';font-size:26px;letter-spacing:7px;color:#ffb648;text-transform:uppercase;
    margin-bottom:14px;opacity:.92}
  .head{font-family:'Anton';font-weight:400;text-transform:uppercase;font-size:104px;line-height:.92;
    letter-spacing:1px;color:#ff9922;
    text-shadow:0 5px 0 #7a2600, 0 6px 0 #7a2600, 5px 0 0 #7a2600, -4px 0 0 #7a2600,
      0 8px 24px rgba(0,0,0,.55), 0 0 40px rgba(255,150,40,.25)}
  .sub{font-family:'Archivo';font-size:33px;line-height:1.32;color:#e9dfff;margin-top:22px;
    max-width:860px;text-shadow:0 2px 8px rgba(0,0,0,.5)}
  .sub b{color:#ffd166;font-weight:400}
  /* device */
  .device{position:absolute;left:50%;bottom:64px;transform:translateX(-50%);
    width:660px;padding:14px;border-radius:40px;background:#080810;
    box-shadow:0 0 0 3px rgba(255,153,34,.55),0 0 0 6px rgba(255,153,34,.14),
      0 40px 90px rgba(0,0,0,.6),0 0 70px rgba(255,120,30,.18)}
  .device img{display:block;width:100%;border-radius:28px}
  .notch{position:absolute;left:50%;top:22px;transform:translateX(-50%);width:120px;height:9px;
    border-radius:6px;background:rgba(255,255,255,.14)}
  </style></head><body>
  <div class="stage">
    <svg class="sky" width="1080" height="1920">${starField(90, 1080, 1920, 7)}</svg>
    <div class="glow"></div>
    <div class="rail">${railTicks()}</div>
    <div class="ftbadge"><div class="mk">▲</div><span class="n">${ft}</span><span class="u">FT</span></div>
    <div class="ftpoint"></div>
    <div class="cap">
      <div class="kicker">${kicker}</div>
      <div class="head">${headline}</div>
      <div class="sub">${sub}</div>
    </div>
    <div class="device"><div class="notch"></div><img src="${shot}"/></div>
  </div></body></html>`;
}
function railTicks() {
  let out = '';
  for (let y = 40; y < 1920; y += 60) {
    const major = (Math.round(y / 60) % 4 === 0);
    out += `<div class="tick ${major ? 'tickL' : 'tickS'}" style="top:${y}px"></div>`;
  }
  return out;
}

// ---- FEATURE GRAPHIC (1024x500) ----
function feature() {
  return `<!doctype html><html><head><meta charset="utf8"><style>
  ${FONTCSS}
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:1024px;height:500px;overflow:hidden}
  .stage{position:relative;width:1024px;height:500px;overflow:hidden;
    background:linear-gradient(160deg,#080816 0%,#12102e 40%,#2a1740 66%,#7a3330 86%,#e8622a 108%);
    font-family:'Archivo'}
  .glow{position:absolute;right:180px;top:-120px;width:640px;height:640px;
    background:radial-gradient(circle,rgba(255,153,34,.22),transparent 60%)}
  .tower{position:absolute;right:-40px;top:-30px;height:620px;
    -webkit-mask-image:linear-gradient(90deg,transparent,#000 32%);
    mask-image:linear-gradient(90deg,transparent,#000 32%);
    filter:drop-shadow(-8px 10px 26px rgba(0,0,0,.5))}
  .left{position:absolute;left:64px;top:0;bottom:0;width:640px;display:flex;flex-direction:column;
    justify-content:center}
  .wm{font-family:'Anton';font-weight:400;font-size:190px;line-height:.8;letter-spacing:2px;color:#ff9922;
    text-shadow:0 7px 0 #7a2600, 7px 0 0 #7a2600, -5px 0 0 #7a2600, 0 9px 0 #5a1c00,
      0 14px 34px rgba(0,0,0,.55),0 0 60px rgba(255,150,40,.3)}
  .tag{font-family:'Archivo';font-style:italic;font-size:30px;color:#ffd08a;margin-top:14px;letter-spacing:1px;
    text-shadow:0 2px 6px rgba(0,0,0,.6)}
  .hook{font-family:'Archivo';font-size:25px;color:#ece3ff;margin-top:20px;max-width:560px;line-height:1.3;
    text-shadow:0 2px 6px rgba(0,0,0,.55)}
  .hook b{color:#ffd166;font-weight:400}
  .rail{position:absolute;left:0;top:0;bottom:0;width:40px;border-right:2px solid rgba(255,170,68,.3);
    background:linear-gradient(90deg,rgba(8,8,20,.6),transparent)}
  .tick{position:absolute;right:0;width:16px;height:2px;background:rgba(255,200,120,.3)}
  </style></head><body>
  <div class="stage">
    <svg style="position:absolute;inset:0" width="1024" height="500">${starField(50, 1024, 300, 3)}</svg>
    <div class="glow"></div>
    <img class="tower" src="${SHOTS.game}"/>
    <div class="rail">${Array.from({length:20},(_,i)=>`<div class="tick" style="top:${i*26+14}px"></div>`).join('')}</div>
    <div class="left">
      <div class="wm">HEAP</div>
      <div class="tag">How high can you climb?</div>
      <div class="hook">Climb a <b>community-built</b> trash heap. Place items, dodge enemies, race to the top.</div>
    </div>
  </div></body></html>`;
}

// ---- render jobs ----
const jobs = [
  { name: '00-feature', w: 1024, h: 500, html: feature() },
  // hero (chosen: climb1 / 170ft, beside the heap wall). climb2 kept in SHOTS as a spare.
  { name: '01-climb', w: 1080, h: 1920, html: phone({
      shot: SHOTS.climb1, ft: '170', kicker: 'A community-built world',
      headline: 'CLIMB<br>THE HEAP', sub: 'Scale a giant tower of trash built by <b>every player</b> — race to the top.' }) },
  { name: '02-place', w: 1080, h: 1920, html: phone({
      shot: SHOTS.place, ft: '538', kicker: 'Every piece stays',
      headline: 'BUILD<br>THE HEAP', sub: 'Drop items onto the heap — <b>every piece you place stays</b> for the next player.' }) },
  { name: '03-salvage', w: 1080, h: 1920, html: phone({
      shot: SHOTS.salvage, ft: '175', kicker: 'Loot the climb',
      headline: 'GRAB<br>SALVAGE', sub: 'Snatch <b>rare salvage</b> for big points and buffs — think +90 jump.' }) },
  { name: '04-leaderboard', w: 1080, h: 1920, html: phone({
      shot: SHOTS.score, ft: '9,819', kicker: 'Compete worldwide',
      headline: 'TOP THE<br>LEADERBOARD', sub: 'Chain kills, keep your pace, climb higher — then <b>rule the global high scores</b>.' }) },
  { name: '05-custom', w: 1080, h: 1920, html: phone({
      shot: SHOTS.custom, ft: '3,120', kicker: 'Make it yours',
      headline: 'DRESS<br>THE BAG', sub: 'Unlock <b>50+ cosmetics</b> — hats, faces, trails — and climb in style.' }) },
  { name: '06-enemy', w: 1080, h: 1920, html: phone({
      shot: SHOTS.enemy, ft: '445', kicker: 'Mind the vermin',
      headline: 'DODGE<br>THE PESTS', sub: 'Rats and critters roam the heap. <b>Stomp them</b> or leap clear.' }) },
  { name: '07-upgrades', w: 1080, h: 1920, html: phone({
      shot: SHOTS.upgrade, ft: '5,400', kicker: 'Progress every run',
      headline: 'UPGRADE<br>&amp; CLIMB', sub: 'Spend coins on <b>jumps, dashes and boosts</b> — every run makes you stronger.' }) },
];

const browser = await chromium.launch();
for (const j of jobs) {
  const page = await browser.newPage({ viewport: { width: j.w, height: j.h }, deviceScaleFactor: 1 });
  await page.setContent(j.html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${DIR}/${j.name}.png` });
  await page.close();
  console.log('rendered', j.name, `${j.w}x${j.h}`);
}

// Tablet variants — the same 7 phone screenshots re-rendered at 1.5x DPR
// (1620x2880) so the shorter side clears Google's 10-inch minimum (1080px)
// comfortably. Reused for both GPP tablet folders: `tablet-screenshots`
// (7-inch) and `large-tablet-screenshots` (10-inch).
fs.mkdirSync(`${DIR}/tablet`, { recursive: true });
for (const j of jobs.filter((j) => /^0[1-7]-/.test(j.name))) {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1.5 });
  await page.setContent(j.html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${DIR}/tablet/${j.name}.png` });
  await page.close();
  console.log('rendered tablet', j.name, '1620x2880');
}
await browser.close();
