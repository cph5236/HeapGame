import { chromium } from '@playwright/test';

const DEVICES: Record<string, { width: number; height: number; deviceScaleFactor: number }> = {
  pixel7:   { width: 448, height: 970,  deviceScaleFactor: 2.6 },
};

const device = DEVICES['pixel7'];
const encodedParams = encodeURIComponent('{"score":5000,"isFailure":false}');
const url = `http://localhost:3000?dev=ScoreScene&params=${encodedParams}`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport:          { width: device.width, height: device.height },
    deviceScaleFactor: device.deviceScaleFactor,
  });
  const page = await context.newPage();

  // Capture all console messages
  page.on('console', msg => {
    console.log(`[${msg.type()}] ${msg.text()}`);
  });

  // Capture page errors
  page.on('pageerror', err => {
    console.error('[PAGE ERROR]', err.message);
  });

  console.log(`Loading ${url}...`);
  await page.goto(url);

  // Wait for canvas to appear
  try {
    await page.waitForSelector('canvas', { timeout: 10000 });
    console.log('Canvas found');
  } catch (e) {
    console.error('Canvas not found after 10s');
  }

  // Wait for render
  await page.waitForTimeout(2000);

  await page.screenshot({ path: 'screenshots/preview.png', fullPage: false });
  await browser.close();

  console.log('Screenshot saved to screenshots/preview.png');
})().catch((err: Error) => {
  console.error('Preview failed:', err.message);
  process.exit(1);
});
