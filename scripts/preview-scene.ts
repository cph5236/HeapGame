import { chromium } from '@playwright/test';
import * as path from 'path';

const DEVICES: Record<string, { width: number; height: number; deviceScaleFactor: number }> = {
  pixel7:   { width: 448, height: 970,  deviceScaleFactor: 2.6 },
  browser:  { width: 480, height: 1042, deviceScaleFactor: 2.6 },
  iphone14: { width: 390, height: 844,  deviceScaleFactor: 3.0 },
  desktop:  { width: 1280, height: 800, deviceScaleFactor: 1.0 },
};

const ALL_DEVICES = Object.keys(DEVICES);

const [,, sceneName, paramsArg = '{}', deviceName = 'pixel7'] = process.argv;

if (!sceneName) {
  console.error('Usage: npm run scene-preview -- <SceneName> [paramsJSON] [device|all|headed]');
  console.error('Devices:', [...ALL_DEVICES, 'all', 'headed'].join(', '));
  process.exit(1);
}

const isAll    = deviceName === 'all';
const isHeaded = deviceName === 'headed';

if (!isAll && !isHeaded && !DEVICES[deviceName]) {
  console.error(`Unknown device "${deviceName}". Available: ${[...ALL_DEVICES, 'all', 'headed'].join(', ')}`);
  process.exit(1);
}

const encodedParams = encodeURIComponent(paramsArg);
const url = `http://localhost:3000?dev=${sceneName}&params=${encodedParams}`;

async function screenshotDevice(deviceKey: string): Promise<void> {
  const device  = DEVICES[deviceKey];
  const outPath = isAll
    ? path.join('screenshots', `${sceneName}-${deviceKey}.png`)
    : path.join('screenshots', 'preview.png');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport:          { width: device.width, height: device.height },
    deviceScaleFactor: device.deviceScaleFactor,
  });
  const page = await context.newPage();

  console.log(`Loading ${sceneName} at ${device.width}×${device.height} (${deviceKey})...`);
  await page.goto(url);
  await page.waitForSelector('canvas', { timeout: 10000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: outPath, fullPage: false });
  await browser.close();

  console.log(`Screenshot saved to ${outPath}`);
}

async function launchHeaded(): Promise<void> {
  const device  = DEVICES['pixel7']; // headed defaults to pixel7 dimensions
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport:          { width: device.width, height: device.height },
    deviceScaleFactor: device.deviceScaleFactor,
  });
  const page = await context.newPage();

  console.log(`Opening ${sceneName} in headed browser (pixel7 dimensions)...`);
  console.log(`URL: ${url}`);
  console.log('Close the browser window to exit.');
  await page.goto(url);
  await page.waitForSelector('canvas', { timeout: 10000 });

  // Keep the browser open until the page is closed
  await page.waitForEvent('close', { timeout: 0 }).catch(() => {});
  await browser.close();
}

(async () => {
  if (isHeaded) {
    await launchHeaded();
  } else {
    await Promise.all((isAll ? ALL_DEVICES : [deviceName]).map(screenshotDevice));
  }
})().catch((err: Error) => {
  console.error('Preview failed:', err.message);
  process.exit(1);
});
