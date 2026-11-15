// Capture stops of the animated tours from a running dev server (cd web && npm run dev).
//   node scripts/tour_shots.mjs [tourId ...]          desktop 1440x900 (+ the black hole tour on a 390x844 phone)
// Writes figures/tours-<tour>-<stop>.png (phone: tours-phone-<tour>-<stop>.png). Each stop is reached with
// __atlas.tours.go(i); the shot is taken `wait` ms after the flight lands, with the tour paused there
// (the stop's animation runs until then), so the caption player and the HUD are in the picture.
import { chromium } from '../web/node_modules/playwright-core/index.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.ATLAS_URL ?? 'http://127.0.0.1:5173/?lang=en';
const OUT = join(ROOT, 'figures');
const only = process.argv.slice(2);

// [tour, stop id, ms after landing]
const SHOTS = [
  ['black-holes', 'bh3', 9000], ['black-holes', 'ring', 9000], ['black-holes', 'tides', 9000], ['black-holes', 'sgra', 6000],
  ['black-holes', 'fall', 22000], ['black-holes', 'm87', 6000],
  ['milky-way', 'orion', 5000], ['milky-way', 'dust', 9000], ['milky-way', 'arms', 5000], ['milky-way', 'orbits', 14000],
  ['star-life', 'giant', 5000], ['star-life', 'sn', 5000], ['star-life', 'bh', 6000],
  ['universe', 'laniakea', 7000], ['universe', 'web', 9000], ['universe', 'cmb', 7000],
  ['solar-system', 'belt', 8000], ['solar-system', 'moon', 14000], ['solar-system', 'mars', 14000],
];
const PHONE = [['black-holes', 'intro', 4000], ['black-holes', 'time', 9000], ['black-holes', 'sgra', 6000]];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-features=WebGPU'],
});

async function run(shots, viewport, prefix) {
  const page = await (await browser.newContext({ viewport, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE);
  await page.waitForFunction(() => window.__atlas?.solar?.surface && window.__atlas?.tours, null, { timeout: 90000 });
  await page.waitForTimeout(4000);
  let current = null;
  for (const [tour, stop, wait] of shots) {
    if (only.length && !only.includes(tour)) continue;
    const list = await page.evaluate(() => window.__atlas.tours.list());
    const ids = list.find((x) => x.id === tour).stops;
    if (current !== tour) {
      await page.evaluate((id) => window.__atlas.tours.start(id), tour);
      current = tour;
    }
    await page.evaluate((i) => window.__atlas.tours.go(i), ids.indexOf(stop));
    await page.waitForTimeout(500);
    await page.waitForFunction(() => !window.__atlas.tours.state().flying, null, { timeout: 60000 });
    await page.waitForTimeout(wait);
    await page.evaluate(() => window.__atlas.tours.pause(true));
    await page.waitForTimeout(400);
    const file = join(OUT, `${prefix}${tour}-${stop}.png`);
    await page.screenshot({ path: file });
    const st = await page.evaluate(() => ({ ...window.__atlas.tours.state(), bh: window.__atlas.bh?.state() }));
    console.log(`${file}  ${JSON.stringify(st)}`);
  }
  if (errors.length) console.log(`page errors: ${errors.slice(0, 5).join(' | ')}`);
  await page.close();
}

await run(SHOTS, { width: 1440, height: 900 }, 'tours-');
await run(PHONE, { width: 390, height: 844 }, 'tours-phone-');
await browser.close();
