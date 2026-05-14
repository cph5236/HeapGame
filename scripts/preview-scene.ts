import { chromium } from '@playwright/test';
import * as path from 'path';

const DEVICES: Record<string, { width: number; height: number; deviceScaleFactor: number }> = {
  pixel7:   { width: 448, height: 970,  deviceScaleFactor: 2.6 },
  browser:  { width: 480, height: 1042, deviceScaleFactor: 2.6 },
  iphone14: { width: 390, height: 844,  deviceScaleFactor: 3.0 },
  desktop:  { width: 1280, height: 800, deviceScaleFactor: 1.0 },
};

const ALL_DEVICES = Object.keys(DEVICES);

// Parse WxH or WxH@S custom dimension syntax, e.g. "1080x1920" or "540x960@2"
function parseCustomDimension(s: string): { width: number; height: number; deviceScaleFactor: number } | null {
  const m = s.match(/^(\d+)x(\d+)(?:@([\d.]+))?$/);
  if (!m) return null;
  const scale = m[3] ? parseFloat(m[3]) : 1.0;
  return { width: parseInt(m[1]), height: parseInt(m[2]), deviceScaleFactor: scale };
}

const [,, sceneName, paramsArg = '{}', deviceName = 'pixel7', customOutPath] = process.argv;

if (!sceneName) {
  console.error('Usage: npm run scene-preview -- <SceneName> [paramsJSON] [device|WxH|WxH@scale|all|headed] [outputPath]');
  console.error('Devices:', [...ALL_DEVICES, 'all', 'headed'].join(', '));
  console.error('Custom: e.g. 540x960@2 for 1080×1920 physical pixels');
  process.exit(1);
}

const isAll       = deviceName === 'all';
const isHeaded    = deviceName === 'headed';
const customDims  = parseCustomDimension(deviceName);

if (!isAll && !isHeaded && !DEVICES[deviceName] && !customDims) {
  console.error(`Unknown device "${deviceName}". Available: ${[...ALL_DEVICES, 'all', 'headed'].join(', ')}`);
  console.error('Or use custom dimensions: WxH or WxH@scale (e.g. 540x960@2)');
  process.exit(1);
}

if (customDims) {
  DEVICES['_custom'] = customDims;
}

const encodedParams = encodeURIComponent(paramsArg);
const url = `http://localhost:3000?dev=${sceneName}&params=${encodedParams}`;

async function screenshotDevice(deviceKey: string, outPathOverride?: string): Promise<void> {
  const device  = DEVICES[deviceKey];
  const outPath = outPathOverride
    ?? (isAll
      ? path.join('screenshots', `${sceneName}-${deviceKey}.png`)
      : path.join('screenshots', 'preview.png'));

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
    const targets = isAll ? ALL_DEVICES : [customDims ? '_custom' : deviceName];
    await Promise.all(targets.map(key => screenshotDevice(key, customDims ? customOutPath : undefined)));
  }
})().catch((err: Error) => {
  console.error('Preview failed:', err.message);
  process.exit(1);
});
