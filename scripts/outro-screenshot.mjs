import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', 'screenshots');

const kind = process.argv[2] ?? 'death';
const delay = parseInt(process.argv[3] ?? '1800', 10);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 448, height: 970 });

const url = `http://localhost:3000/?dev=GameScene&params=${encodeURIComponent(JSON.stringify({ _devOutro: kind }))}`;
await page.goto(url);

// Wait for canvas to appear then wait for animation to be mid-flight
await page.waitForSelector('canvas');
await page.waitForTimeout(delay);

await page.screenshot({ path: path.join(outDir, `preview-${kind}-outro.png`) });
console.log(`Saved screenshots/preview-${kind}-outro.png`);

await browser.close();
