import { chromium } from '@playwright/test';

const DEVICES: Record<string, { width: number; height: number; deviceScaleFactor: number }> = {
  pixel7:  { width: 412, height: 915, deviceScaleFactor: 2.6 },
  iphone14: { width: 390, height: 844, deviceScaleFactor: 3.0 },
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1.0 },
};

const [,, sceneName, paramsArg = '{}', deviceName = 'pixel7'] = process.argv;

if (!sceneName) {
  console.error('Usage: npm run scene-preview -- <SceneName> [paramsJSON] [device]');
  console.error('Devices:', Object.keys(DEVICES).join(', '));
  process.exit(1);
}

const device = DEVICES[deviceName];
if (!device) {
  console.error(`Unknown device "${deviceName}". Available: ${Object.keys(DEVICES).join(', ')}`);
  process.exit(1);
}

const encodedParams = encodeURIComponent(paramsArg);
const url = `http://localhost:3000?dev=${sceneName}&params=${encodedParams}`;
const outPath = 'screenshots/preview.png';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport:          { width: device.width, height: device.height },
    deviceScaleFactor: device.deviceScaleFactor,
  });
  const page = await context.newPage();

  console.log(`Loading ${sceneName} at ${device.width}×${device.height} (${deviceName})...`);
  await page.goto(url);

  // Wait for Phaser canvas to appear
  await page.waitForSelector('canvas', { timeout: 10000 });

  // Wait for opening animations to settle
  await page.waitForTimeout(2000);

  await page.screenshot({ path: outPath, fullPage: false });
  await browser.close();

  console.log(`Screenshot saved to ${outPath}`);
})();
