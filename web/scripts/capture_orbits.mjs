// Galactic orbits on the 4D time slider: capture the Sun's neighbourhood at −50 Myr, now and
// +50 Myr with an isolated headless Chrome (WebGPU), check that a GPU pick at a moved star's
// JS-predicted screen position (orbits/integrate.ts gpuPosition, the shader's twin) returns that
// star, and capture its info card with the "Galactic orbit" row.
// usage (dev server running): node scripts/capture_orbits.mjs [outdir=../figures] [baseUrl] [view] [prefix=orbits]
import { chromium } from 'playwright-core';

const [,, outdir = '../figures', base = 'http://localhost:5173/', view = 'v=0,0,0,2600,-120,32', prefix = 'orbits'] = process.argv;
const common = `${view}&l=stars-gaia-preview,~gaia-sky,~dust,~synthetic-stars`;
const SHOTS = [['minus50Myr', -50], ['now', 0], ['plus50Myr', 50]];

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-features=WebGPU'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text().slice(0, 400)}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('response', (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`); });

await page.goto(`${base}?lang=en#${common}`);
await page.waitForFunction(() => window.__atlas?.stats, null, { timeout: 30000 });
const settle = async () => {
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(400);
    const s = await page.evaluate(() => window.__atlas.stats());
    if (i > 4 && s.inFlight === 0 && s.queued === 0 && !s.fading) return s;
  }
  return page.evaluate(() => window.__atlas.stats());
};
let s = await settle();
console.log('backend', s.backend, JSON.stringify(s.layers.find((l) => l.id === 'stars-gaia-preview')));
for (const [name, myr] of SHOTS) {
  await page.evaluate((m) => window.__atlas.setEpoch(m), myr);
  s = await settle();
  await page.evaluate(() => window.__atlas.setContinuous(true));
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__atlas.setContinuous(false));
  await page.screenshot({ path: `${outdir}/${prefix}-${name}.png` });
  const ui = await page.evaluate(() => ({
    epoch: document.querySelector('.t-epoch')?.textContent, slider: document.querySelector('.t-epoch-range')?.value,
    note: document.querySelector('.t-note')?.textContent, hash: location.hash,
  }));
  console.log(name, JSON.stringify({ epoch: await page.evaluate(() => window.__atlas.epoch()), drawnPoints: s.drawnPoints, drawnNodes: s.drawnNodes,
    movingNodes: s.movingNodes, blobs: s.blobs, pending: s.pending?.['stars-gaia-preview'], ui }));
  if (myr !== 0) {
    // GPU compute output vs its JS twin, every point of the drawn moving nodes
    console.log('  readback', JSON.stringify(await page.evaluate(() => window.__atlas.orbitReadback('stars-gaia-preview', 400))));
    const probe = await page.evaluate(() => window.__atlas.movedProbe('stars-gaia-preview'));
    if (probe) {
      await page.evaluate(([x, y]) => window.__atlas.pickAt(x, y), [probe.x, probe.y]);
      await page.waitForTimeout(400);
      const sel = (await page.evaluate(() => window.__atlas.stats())).selection;
      console.log(`  pick at the JS-predicted position of Gaia DR3 ${probe.id} (${probe.x.toFixed(1)}, ${probe.y.toFixed(1)}) ->`, sel?.title, sel?.title?.endsWith(probe.id) ? 'MATCH' : 'MISMATCH');
      await page.keyboard.press('Escape');
      await page.evaluate(() => document.getElementById('info-close')?.click());
    } else console.log('  no probe star on screen');
  }
}
console.log('console/http problems:', logs.length ? logs : 'none');
await browser.close();
