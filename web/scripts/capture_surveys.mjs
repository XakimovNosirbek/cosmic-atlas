// Capture the galaxy redshift surveys together in a thin slab through the Sun, seen from 300 Mpc,
// then each survey alone in the same view, and print per capture the backend, drawn points and the
// light fraction per layer. Saves <outdir>/surveys-<name>.png.
// usage (dev server running): node scripts/capture_surveys.mjs [outdir=../figures] [query] [baseUrl]
//   env SLAB = slab half-thickness in Mpc (default 25), DIST = camera distance in pc (default 3e8),
//   YAW / PITCH = view direction in degrees (default -150 / 0: the slab holds both Galactic caps)
import { chromium } from 'playwright-core';

const [,, outdir = '../figures', query = '', base = 'http://localhost:5173/'] = process.argv;
const SLAB = +(process.env.SLAB ?? 25);
const DIST = +(process.env.DIST ?? 3e8);
const YAW = +(process.env.YAW ?? -150);
const PITCH = +(process.env.PITCH ?? 0);
const SURVEYS = ['galaxies-desi', 'galaxies-sdss', 'galaxies-2mrs', 'galaxies-6dfgs', 'galaxies-2dfgrs', 'galaxies-euclid'];
const OTHER_OFF = ['galaxies-cf4', 'local-group', 'local-volume', 'stars-gaia', 'stars-gaia-preview', 'milky-way-model', 'gaia-sky', 'solar',
  'dust', 'star-clusters', 'gw-volumes', 'cmb', 'frb', 'neutrinos', 'small-bodies', 'satellites'];
const CAPTURES = [
  ['combined', SURVEYS],
  ['before', ['galaxies-desi', 'galaxies-2mrs']],
  // Euclid DR1 is a pencil beam at z 0.85-1.85 (3-5 Gpc): nothing of it lies in this slab, it gets its own view below
  ...SURVEYS.filter((id) => id !== 'galaxies-euclid').map((id) => [id.replace('galaxies-', ''), [id]]),
];

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-features=WebGPU'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('response', (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`); });
await page.goto(`${base}${query}#v=0,0,0,${DIST},${YAW},${PITCH}&slab=${SLAB}`);
await page.waitForFunction(() => window.__atlas && window.__atlas.stats, null, { timeout: 30000 });
console.log('navigator.gpu:', await page.evaluate(async () => { if (!navigator.gpu) return 'absent'; const a = await navigator.gpu.requestAdapter(); return a ? `${a.info?.vendor} ${a.info?.architecture}` : 'no adapter'; }));
await page.waitForTimeout(3000);
for (const id of OTHER_OFF) await page.evaluate((i) => window.__atlas.setLayer(i, false), id);
// the layer panel and stats box cover a third of the frame: hide them in the figure (stats are printed)
await page.addStyleTag({ content: '#layers, #stats, #labels { display: none !important; }' });
await page.evaluate(([s]) => window.__atlas.setSlab(s), [SLAB]);
await page.evaluate(([d, y, p]) => window.__atlas.setView({ focus: [0, 0, 0], dist: d, yaw: (y * Math.PI) / 180, pitch: (p * Math.PI) / 180 }), [DIST, YAW, PITCH]);
for (const [name, on] of CAPTURES) {
  for (const id of SURVEYS) await page.evaluate(([i, v]) => window.__atlas.setLayer(i, v), [id, on.includes(id)]);
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(500);
    const s = await page.evaluate(() => window.__atlas.stats());
    if (i > 5 && s.inFlight === 0 && s.queued === 0) break;
  }
  await page.evaluate(() => window.__atlas.setContinuous(true));
  await page.waitForTimeout(1500);
  const s = await page.evaluate(() => window.__atlas.stats());
  await page.evaluate(() => window.__atlas.setContinuous(false));
  await page.screenshot({ path: `${outdir}/surveys-${name}.png` });
  console.log(name, JSON.stringify({
    backend: s.backend, fps: +s.fps.toFixed(1), slab: s.slab, drawnPoints: s.drawnPoints, loadedNodes: s.loadedNodes,
    light: Object.fromEntries(Object.entries(s.light).filter(([k]) => k.startsWith('galaxies')).map(([k, v]) => [k, +v.toFixed(4)])),
    dist: s.view.dist,
  }));
}
// the Euclid Deep Field North beam with DESI and SDSS for context: no slab, camera 2.5 Gpc from the
// beam centre (RA 269.7, Dec +66.0 at z = 1.3, Planck18 D_C 4.08 Gpc), looking across the line of sight
await page.evaluate(() => window.__atlas.setSlab(0));
for (const id of SURVEYS) await page.evaluate(([i, v]) => window.__atlas.setLayer(i, v), [id, ['galaxies-euclid', 'galaxies-desi', 'galaxies-sdss'].includes(id)]);
for (const [name, on] of [['euclid-edfn', ['galaxies-euclid', 'galaxies-desi', 'galaxies-sdss']], ['euclid-edfn-only', ['galaxies-euclid']]]) {
  for (const id of SURVEYS) await page.evaluate(([i, v]) => window.__atlas.setLayer(i, v), [id, on.includes(id)]);
  await page.evaluate(() => window.__atlas.setView({ focus: [-3.548e8, 3.5187e9, 2.0351e9], dist: 2.5e9, yaw: (60 * Math.PI) / 180, pitch: (10 * Math.PI) / 180 }));
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(500);
    const s = await page.evaluate(() => window.__atlas.stats());
    if (i > 5 && s.inFlight === 0 && s.queued === 0) break;
  }
  await page.waitForTimeout(1000);
  const s = await page.evaluate(() => window.__atlas.stats());
  await page.screenshot({ path: `${outdir}/surveys-${name}.png` });
  console.log(name, JSON.stringify({ backend: s.backend, drawnPoints: s.drawnPoints, light: Object.fromEntries(Object.entries(s.light).filter(([k]) => k.startsWith('galaxies')).map(([k, v]) => [k, +v.toFixed(4)])), dist: s.view.dist }));
}
console.log('console/http problems:', logs.length ? logs : 'none');
await browser.close();
