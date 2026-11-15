// Cosmography captures (headless WebGPU, Chromium flags of capture_views.mjs):
//   laniakea-sg-200mpc.png   supergalactic top-down view, ±200 Mpc vertically, grid + streamlines + density
//   laniakea-sg-200mpc-flow.png  the same with streamlines only (no density volume)
//   laniakea-labels.png      the "Laniakea" named view (#focus=laniakea): basins, attractors, cluster labels
//   laniakea-groups.png      Virgo / Local Volume groups with the 2MRS group markers, a group card open
//   laniakea-density-card.png  a click on the Shapley overdensity: the volume's info card
// Prints the layer state, GPU ms per frame (?gputime) and any console / HTTP problems.
// usage (dev server up): node scripts/capture_laniakea.mjs [outdir=../figures] [baseUrl=http://localhost:5173/]
import { chromium } from 'playwright-core';

const [,, outdir = '../figures', base = 'http://localhost:5173/'] = process.argv;
const url = `${base}${base.includes('?') ? '&' : '?'}gputime&lang=en`;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-features=WebGPU'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('response', (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`); });
await page.goto(url);
await page.waitForFunction(() => window.__atlas?.cosmo, null, { timeout: 90000, polling: 250 });
const settle = async (ms = 800) => {
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(400);
    const s = await page.evaluate(() => window.__atlas.stats());
    if (i > 4 && s.inFlight === 0 && s.queued === 0) break;
  }
  await page.evaluate(() => window.__atlas.setContinuous(true));
  await page.waitForTimeout(ms);
  await page.evaluate(() => window.__atlas.setContinuous(false));
  await page.waitForTimeout(300);
};
const A = (f, ...a) => page.evaluate(f, ...a);
console.log('backend', await A(() => window.__atlas.stats().backend));
for (const id of ['sg-grid', 'cf4-flow', 'cf4-density']) await A((id) => window.__atlas.setLayer(id, true), id);
// the comparison with Tully et al. 2014, Fig. 1 wants the flows over the all-sky 2MRS galaxies only: the DESI
// footprint, the group rings and the multi-messenger markers would bury them at this scale
for (const id of ['galaxies-desi', 'galaxies-sdss', 'galaxies-2dfgrs', 'galaxies-6dfgs', 'groups-2mrs', 'gw-volumes', 'frb', 'neutrinos']) await A((id) => window.__atlas.setLayer(id, false), id);
console.log('load', await A(() => window.__atlas.cosmo.load()));
await A(() => document.getElementById('info')?.setAttribute('hidden', ''));
if ((await A(() => document.getElementById('layers-toggle').getAttribute('aria-expanded'))) === 'true') await page.click('#layers-toggle');

// 1. supergalactic top-down view: camera on +SGZ at the distance that shows ±200 Mpc vertically (fov 55°)
const d200 = 2e8 / Math.tan((27.5 * Math.PI) / 180);
await A((d) => window.__atlas.cosmo.sgView(d), d200);
await settle(1200);
const gpu = await A(() => window.__atlas.bh.gpuMs(2500));
await page.screenshot({ path: `${outdir}/laniakea-sg-200mpc.png` });
console.log('sg-200mpc', JSON.stringify(await A(() => window.__atlas.cosmo.state())), 'GPU ms median/p90', gpu?.medianMs?.toFixed(2), gpu?.p90Ms?.toFixed(2));
await A(() => window.__atlas.setLayer('cf4-density', false));
await settle();
await page.screenshot({ path: `${outdir}/laniakea-sg-200mpc-flow.png` });
const gpuFlow = await A(() => window.__atlas.bh.gpuMs(2500));
await A(() => window.__atlas.setLayer('cf4-density', true));
console.log('flow only GPU ms', gpuFlow?.medianMs?.toFixed(2));
// screen positions of the literature checkpoints in the top-down view
await A((d) => window.__atlas.cosmo.sgView(d), d200);
await settle();
for (const n of ['Great Attractor', 'Shapley attractor', 'Norma Cluster', 'Abell 3558', 'Virgo Cluster', 'Coma Cluster', 'Perseus Cluster', 'Laniakea', 'Vela Supercluster']) {
  console.log('  screen', n, JSON.stringify(await A((n) => window.__atlas.cosmo.screenOf(n), n)));
}

// 2. the Laniakea named view, labels on
await A(() => { location.hash = '#focus=laniakea'; });
await page.waitForTimeout(4500);
await settle(1000);
await page.screenshot({ path: `${outdir}/laniakea-labels.png` });
console.log('labels', JSON.stringify(await A(() => [...document.querySelectorAll('#labels .label, #labels [data-kind]')].map((l) => l.textContent).filter(Boolean).slice(0, 40))));

// 3. groups: Virgo region with markers, the Virgo Cluster card
await A(() => window.__atlas.setLayer('cf4-density', false));
await A(() => window.__atlas.setLayer('cf4-flow', false));
await A(() => window.__atlas.setLayer('groups-2mrs', true));
await A(() => window.__atlas.showEntry('Virgo Cluster'));
const virgo = await A(() => window.__atlas.messengers.entryXyz('Virgo Cluster'));
await A((v) => window.__atlas.setView({ focus: v, dist: 3.5e7, yaw: 1.2, pitch: 0.5 }), virgo);
await settle();
await A(() => window.__atlas.showEntry('Virgo Cluster'));
await page.waitForTimeout(400);
console.log('virgo card', JSON.stringify(await A(() => [...document.querySelectorAll('#info-rows dt')].map((dt) => `${dt.textContent}: ${dt.nextElementSibling?.textContent}`))));
await page.screenshot({ path: `${outdir}/laniakea-groups.png` });

// 4. density pick on Shapley from the top-down view
await A(() => window.__atlas.setLayer('cf4-density', true));
await A(() => window.__atlas.setLayer('cf4-flow', true));
await A((d) => window.__atlas.cosmo.sgView(d), d200);
await settle();
const sh = await A(() => window.__atlas.cosmo.screenOf('Shapley attractor'));
if (sh) {
  console.log('pick at Shapley attractor', JSON.stringify(await A((p) => window.__atlas.cosmo.pickAt(p.x, p.y), sh)));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outdir}/laniakea-density-card.png` });
}
console.log('console/http problems:', logs.length ? logs : 'none');
await browser.close();
