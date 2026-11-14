// Frame rate of the GPU orbit integrator (orbits/gpu.ts) at several star epochs, for one layer.
// For each epoch it waits until the velocity streams are in, renders continuously and reports
// renders per second (GPU-bound throughput, 2 frames in flight), requestAnimationFrame intervals
// and the GPU time per frame from timestamp queries (?gputime). "drag" changes the epoch every
// frame from +1 to +100 Myr, like a user dragging the slider.
// usage (dev server running):
//   node scripts/perf_orbits.mjs [layer=synthetic-stars-moving] [epochs=0,1,10,100,drag] [view] [baseUrl] [--uncapped] [--vertex] [--budget=M]
import { chromium } from 'playwright-core';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const uncapped = process.argv.includes('--uncapped');
const budget = process.argv.find((a) => a.startsWith('--budget='))?.split('=')[1];
// --vertex: integrate in the vertex shader every frame (the WebGL2 path) instead of the compute pass
const vertex = process.argv.includes('--vertex');
const [layer = 'synthetic-stars-moving', epochs = '0,1,10,100,drag', view = 'v=0,0,0,2600,-120,32', base = 'http://localhost:5173/'] = args;
// only the measured layer: the static synthetic stars, galaxies, dust and the sky image are off
const others = ['stars-gaia-preview', 'synthetic-stars', 'galaxies-desi', 'galaxies-2mrs', 'local-group', 'local-volume', 'star-clusters', 'gaia-sky', 'dust', 'milky-way-model']
  .filter((id) => id !== layer).map((id) => `~${id}`);
const hash = `#${view}&l=${[layer, ...others].join(',')}`;
const flags = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-features=WebGPU'];
if (uncapped) flags.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: flags });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => problems.push(e.message));
await page.goto(`${base}?lang=en&gputime${vertex ? '&orbits=vertex' : ''}${hash}`);
await page.waitForFunction(() => window.__atlas, null, { timeout: 30000 });
if (budget) await page.evaluate((v) => { const el = document.getElementById('budget'); el.max = String(Math.max(+el.max, v)); el.value = String(v); el.dispatchEvent(new Event('input')); }, +budget);

const settle = async () => {
  const t0 = Date.now();
  for (;;) {
    await page.waitForTimeout(500);
    const s = await page.evaluate(() => window.__atlas.stats());
    if ((Date.now() - t0 > 3000 && s.inFlight === 0 && s.queued === 0 && !s.fading) || Date.now() - t0 > 90000) return s;
  }
};

const measure = (drag) => page.evaluate(async (drag) => {
  const A = window.__atlas;
  A.setContinuous(true);
  await new Promise((res) => setTimeout(res, 1000));
  const raf = [];
  let last = performance.now();
  let on = true;
  let k = 0;
  const tick = (t) => {
    raf.push(t - last);
    last = t;
    if (drag) A.setEpoch(1 + ((k++ * 0.7) % 99));
    if (on) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const fps = [];
  for (let i = 0; i < 4; i++) {
    await new Promise((res) => setTimeout(res, 1000));
    fps.push(A.stats().fps);
  }
  on = false;
  const g = await A.bh.gpuMs(2000);
  A.setContinuous(false);
  raf.sort((a, b) => a - b);
  const q = (p) => raf[Math.min(raf.length - 1, Math.floor(p * raf.length))];
  const s = A.stats();
  return { backend: s.backend, drawnPoints: s.drawnPoints, movingNodes: s.movingNodes, drawnNodes: s.drawnNodes, fps, rafP50: q(0.5), rafP95: q(0.95), gpu: g };
}, drag);

for (const e of epochs.split(',')) {
  const drag = e === 'drag';
  await page.evaluate((m) => window.__atlas.setEpoch(m), drag ? 50 : +e);
  const s = await settle();
  const r = await measure(drag);
  const meanFps = r.fps.reduce((a, b) => a + b, 0) / r.fps.length;
  console.log(JSON.stringify({ layer, epochMyr: e, path: vertex ? 'vertex' : 'compute', uncapped, backend: r.backend, drawnM: +(r.drawnPoints / 1e6).toFixed(3), movingNodes: r.movingNodes, drawnNodes: r.drawnNodes,
    fpsMean: +meanFps.toFixed(1), fpsMin: +Math.min(...r.fps).toFixed(1), rafP50: +r.rafP50.toFixed(1), rafP95: +r.rafP95.toFixed(1),
    gpuMedianMs: r.gpu.medianMs && +r.gpu.medianMs.toFixed(2), gpuP90Ms: r.gpu.p90Ms && +r.gpu.p90Ms.toFixed(2), steps: await page.evaluate(() => window.__atlas.orbitSteps?.() ?? null), pending: s.pending?.[layer],
    orbitPass: e !== '0' && !drag ? await page.evaluate(() => window.__atlas.timeOrbitPass?.(5)) : null }));
}
console.log(JSON.stringify({ problems: problems.length ? problems : 'none' }));
await browser.close();
