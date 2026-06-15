// Verifies the physical-backing-store mechanism at a simulated high DPR.
// Requires the dev server running (npm run dev → http://localhost:3000).
// Run: node scripts/dpr-gate.mjs
import { chromium } from 'playwright';

const DPR = 2.5;
// `?canvas` forces the Canvas renderer (headless WebGL has no framebuffer and
// never boots) while keeping real DPR — so this gate exercises the physical
// backing-store path on a renderer that reliably starts running.
const URL = 'http://localhost:3000/?canvas';

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 411, height: 891 },
  deviceScaleFactor: DPR,
});
const page = await context.newPage();
await page.goto(URL, { waitUntil: 'networkidle' });
// Wait until the game is running AND applyCanvasSize has pinned the CSS style —
// proves the boot-time sizing actually took effect (not just that game exists).
await page.waitForFunction(
  () => window.game?.isRunning === true && window.game.scale.canvas.style.width !== '',
  null,
  { timeout: 20000 },
);

const result = await page.evaluate(() => {
  const g = window.game;
  const canvas = g.scale.canvas;
  const parent = document.getElementById('game');
  const cssW = parent.clientWidth;
  const tx = g.scale.transformX(cssW / 2);

  // Access canvas.style.width directly; it's set via JavaScript property, not HTML attribute
  const styleW = canvas.style.width;

  return {
    backingW: canvas.width,
    styleW: styleW,
    cssW,
    expectedBackingW: Math.round(cssW * 2.5),
    transformXCenter: tx,
    expectedTransformX: canvas.width / 2,
  };
});

const okBacking = Math.abs(result.backingW - result.expectedBackingW) <= 2;
const okStyle = result.styleW === result.cssW + 'px';
const okTransform = Math.abs(result.transformXCenter - result.expectedTransformX) <= 3;

console.log(JSON.stringify(result, null, 2));
console.log({ okBacking, okStyle, okTransform });

await page.screenshot({ path: 'dpr-gate.png' });
await browser.close();

if (!(okBacking && okStyle && okTransform)) { console.error('DPR GATE FAILED'); process.exit(1); }
console.log('DPR GATE PASSED');
