// Galactic orbits on the 4D time slider (orbits/), captured with an isolated headless Chrome (WebGPU):
//   1. the Sun's neighbourhood at −50 Myr, now and +50 Myr (Gaia 100 pc layer, wide view)
//   2. at each moved epoch: the GPU compute output read back and compared with its JS twin
//      (orbits/integrate.ts gpuDisplacement) for every drawn point, and, from a closer view, a GPU
//      pick at a star's JS-predicted screen position (must return that star)
//   3. the info card of a picked star with its "Galactic orbit" row
//   4. saved views: three states saved, the dialog, a #story= link played to its last state
// usage (dev server running): node scripts/capture_orbits.mjs [outdir=../figures] [baseUrl] [prefix=orbits]
import { chromium } from 'playwright-core';

const [,, outdir = '../figures', base = 'http://localhost:5173/', prefix = 'orbits'] = process.argv;
// only the 100 pc Gaia stars: the Milky Way model, galaxies, dust and the sky image are off
const LAYERS = 'l=stars-gaia-preview,~gaia-sky,~dust,~synthetic-stars,~star-clusters,~milky-way-model,~galaxies-desi,~galaxies-2mrs,~local-group,~local-volume';
// +3 mag: the stars are 1–3 kpc from the camera in the wide view
const EXPOSURE = 3;
const WIDE = { focus: [0, 0, 0], dist: 2600, yaw: -2.1, pitch: 0.9 };
const NEAR = { focus: [0, 0, 0], dist: 300, yaw: -2.1, pitch: 0.5 };
const SHOTS = [['minus50Myr', -50], ['now', 0], ['plus50Myr', 50]];

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-features=WebGPU'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const logs = [];
const watch = (p) => {
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text().slice(0, 400)}`); });
  p.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  p.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('alasky')) logs.push(`[http ${r.status()}] ${r.url()}`); });
};
watch(page);

await page.goto(`${base}?lang=en#v=0,0,0,3200,-120,38&${LAYERS}`);
await page.waitForFunction(() => window.__atlas?.stats, null, { timeout: 30000 });
const settle = async (p = page) => {
  for (let i = 0; i < 40; i++) {
    await p.waitForTimeout(400);
    const s = await p.evaluate(() => window.__atlas.stats());
    if (i > 4 && s.inFlight === 0 && s.queued === 0 && !s.fading) return s;
  }
  return p.evaluate(() => window.__atlas.stats());
};
const frame = async () => {
  await page.evaluate(() => window.__atlas.setContinuous(true));
  await page.waitForTimeout(700);
  await page.evaluate(() => window.__atlas.setContinuous(false));
};
const infoRows = () => page.evaluate(() => [...document.querySelectorAll('#info-rows dt')].map((dt) => `${dt.textContent}: ${dt.nextElementSibling?.textContent}`));
const closeInfo = () => page.evaluate(() => document.getElementById('info-close')?.click());

await page.evaluate((e) => window.__atlas.setExposure(e), EXPOSURE);
let s = await settle();
console.log('backend', s.backend, JSON.stringify(s.layers.find((l) => l.id === 'stars-gaia-preview')));
for (const [name, myr] of SHOTS) {
  await page.evaluate((v) => window.__atlas.setView(v), WIDE);
  await page.evaluate((m) => window.__atlas.setEpoch(m), myr);
  s = await settle();
  await frame();
  await page.screenshot({ path: `${outdir}/${prefix}-${name}.png` });
  const ui = await page.evaluate(() => ({ epoch: document.querySelector('.t-epoch')?.textContent, note: document.querySelector('.t-note')?.textContent?.slice(0, 90), hash: location.hash }));
  console.log(name, JSON.stringify({ epoch: await page.evaluate(() => window.__atlas.epoch()), steps: await page.evaluate(() => window.__atlas.orbitSteps()),
    drawnPoints: s.drawnPoints, movingNodes: s.movingNodes, pending: s.pending?.['stars-gaia-preview'], ui }));
  if (myr === 0) continue;
  const rb = await page.evaluate(() => window.__atlas.orbitReadback('stars-gaia-preview', 400));
  console.log('  GPU vs JS twin:', JSON.stringify({ points: rb.points, steps: rb.steps, p50Pc: rb.p50Pc, p99Pc: rb.p99Pc, worstAbsPc: rb.worstAbsPc, worstAt: rb.worstAt }));
  await page.evaluate((v) => window.__atlas.setView(v), NEAR);
  await page.evaluate(() => window.__atlas.setExposure(0));
  await settle();
  await frame();
  const probe = await page.evaluate(() => window.__atlas.movedProbe('stars-gaia-preview'));
  if (!probe) {
    console.log('  no probe star on screen');
    await page.evaluate((e) => window.__atlas.setExposure(e), EXPOSURE);
    continue;
  }
  await page.evaluate(([x, y]) => window.__atlas.pickAt(x, y), [probe.x, probe.y]);
  await page.waitForTimeout(500);
  const sel = (await page.evaluate(() => window.__atlas.stats())).selection;
  console.log(`  pick at the JS-predicted position of Gaia DR3 ${probe.id} (${probe.x.toFixed(1)}, ${probe.y.toFixed(1)}) ->`, sel?.title, sel?.title?.endsWith(probe.id) ? 'MATCH' : 'MISMATCH');
  await closeInfo();
  await page.evaluate((e) => window.__atlas.setExposure(e), EXPOSURE);
}

// ---- orbit card: the brightest star with a radial velocity on screen at +10 Myr
await page.evaluate((v) => window.__atlas.setView(v), NEAR);
await page.evaluate(() => window.__atlas.setExposure(0));
await page.evaluate(() => window.__atlas.setEpoch(10));
await settle();
await frame();
const probe = await page.evaluate(() => window.__atlas.movedProbe('stars-gaia-preview'));
await page.evaluate(([x, y]) => window.__atlas.pickAt(x, y), [probe.x, probe.y]);
await page.waitForTimeout(800);
await frame();
await page.screenshot({ path: `${outdir}/${prefix}-card.png` });
console.log('orbit card for', (await page.evaluate(() => window.__atlas.stats())).selection?.title, JSON.stringify(await infoRows()));
console.log('  note:', await page.evaluate(() => document.getElementById('info-note')?.textContent));

// ---- saved views: save three, show the dialog, then play them from a #story= link
await page.evaluate(() => window.__atlas.states.clear());
await page.evaluate(() => window.__atlas.states.save('Card star at +10 Myr'));
await closeInfo();
for (const [name, myr] of [['Neighbourhood, 50 Myr ago', -50], ['Neighbourhood in 50 Myr', 50]]) {
  await page.evaluate(([v, m]) => { window.__atlas.setView(v); window.__atlas.setEpoch(m); }, [WIDE, myr]);
  await page.waitForTimeout(600);
  await page.evaluate((n) => window.__atlas.states.save(n), name);
}
const saved = await page.evaluate(() => window.__atlas.states.list());
console.log('saved states:', JSON.stringify(saved));
await page.evaluate(() => window.__atlas.states.open());
await page.waitForTimeout(300);
await page.screenshot({ path: `${outdir}/${prefix}-states.png` });
await page.keyboard.press('Escape');

// a fresh page from the story link must play all three and end in the last one (camera, epoch)
const storyHash = await page.evaluate(() => window.__atlas.states.storyHash());
const p2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
watch(p2);
await p2.goto(`${base}?lang=en${storyHash}`);
await p2.waitForFunction(() => window.__atlas?.stats, null, { timeout: 30000 });
const t0 = Date.now();
const seen = new Set();
const trace = [];
for (;;) {
  await p2.waitForTimeout(700);
  const st = await p2.evaluate(() => ({ epoch: window.__atlas.epoch(), caption: document.getElementById('caption')?.hidden ? null : document.querySelector('#caption b')?.textContent }));
  if (st.caption && !seen.has(st.caption)) {
    seen.add(st.caption);
    trace.push(`${((Date.now() - t0) / 1000).toFixed(1)} s "${st.caption}"`);
  }
  const idle = await p2.evaluate(() => document.getElementById('tour')?.getAttribute('aria-pressed') !== 'true');
  if ((seen.size === 3 && idle && Date.now() - t0 > 5000) || Date.now() - t0 > 60000) break;
}
await p2.waitForTimeout(800); // the hash is written 0.4 s after the story ends
console.log('story playback:', trace.join(' | '));
console.log('  ended at', JSON.stringify(await p2.evaluate(() => ({ epoch: window.__atlas.epoch(), dist: window.__atlas.stats().view.dist, hash: location.hash }))));
await p2.close();
console.log('console/http problems:', logs.length ? logs : 'none');
await browser.close();
