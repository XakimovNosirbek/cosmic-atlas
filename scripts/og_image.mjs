// Render the social preview image (Open Graph / Twitter card), 1200x630, into web/public/og-image.jpg.
//   node scripts/og_image.mjs [baseUrl=https://cosmic.bristleconelab.org/] [out=web/public/og-image.jpg]
// The black hole tour is stopped at its "Einstein ring" stop (Gaia BH3 bending the Milky Way), the UI is
// hidden and a title card is drawn on the left. The page is rendered 1700 px wide and the left 1200 px
// kept, so the hole (centred in the view) lands on the right, clear of the card.
// Numbers on the card come from the README data table; update both together.
import { chromium } from '../web/node_modules/playwright-core/index.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [,, base = 'https://cosmic.bristleconelab.org/', out = join(ROOT, 'web/public/og-image.jpg')] = process.argv;

const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-features=WebGPU'],
});
const page = await browser.newPage({ viewport: { width: 1700, height: 630 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${base}?lang=en`);
await page.waitForFunction(() => window.__atlas?.tours, null, { timeout: 120000 });
await page.waitForTimeout(4000);

const ids = (await page.evaluate(() => window.__atlas.tours.list())).find((x) => x.id === 'black-holes').stops;
await page.evaluate(() => window.__atlas.tours.start('black-holes'));
await page.evaluate((i) => window.__atlas.tours.go(i), ids.indexOf('ring'));
await page.waitForTimeout(500);
await page.waitForFunction(() => !window.__atlas.tours.state().flying, null, { timeout: 90000 });
await page.waitForTimeout(6000);
await page.evaluate(() => window.__atlas.tours.pause(true));

await page.addStyleTag({ content: `
  body > *:not(#view):not(#og-card):not(#og-note) { visibility: hidden !important; }
  #og-card { position: fixed; left: 52px; top: 50%; transform: translateY(-50%); width: 430px; padding: 32px 34px 28px; z-index: 100;
    background: rgba(6, 9, 16, 0.9); border: 1px solid rgba(201, 166, 107, 0.28); border-radius: 18px; color: #ece6da;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5); }
  #og-card h1 { font: italic 500 50px/1.05 'Spectral', Georgia, serif; color: #e3c48f; margin: 0 0 14px; letter-spacing: -0.01em; }
  #og-card p { font: 400 19px/1.42 'IBM Plex Sans', -apple-system, 'Helvetica Neue', Arial, sans-serif; margin: 0 0 20px; color: #c9c2b4; }
  #og-card .big { font: 600 50px/1 'IBM Plex Sans', -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #e3c48f; margin: 0 0 8px; }
  #og-card .sub { margin: 0 0 22px; font-size: 17px; }
  #og-card .url { font: 600 16px/1 ui-monospace, 'SF Mono', Menlo, monospace; color: #e3c48f; }
  #og-note { position: fixed; left: 1188px; bottom: 16px; transform: translateX(-100%); z-index: 100; white-space: nowrap;
    font: 400 13px/1 'IBM Plex Sans', -apple-system, Arial, sans-serif; color: rgba(236, 230, 218, 0.72); }
` });
await page.evaluate(() => {
  const c = document.createElement('div');
  c.id = 'og-card';
  c.innerHTML = `<h1>Cosmic Atlas</h1>
    <p>A 3D map of the real universe in your browser, from Earth to the cosmic web.</p>
    <div class="big">39.6 million</div>
    <p class="sub">Gaia stars, plus 15 million DESI galaxies</p>
    <div class="url">cosmic.bristleconelab.org</div>`;
  const n = document.createElement('div');
  n.id = 'og-note';
  n.textContent = 'The Milky Way bent by the black hole Gaia BH3 (ray-traced)';
  document.body.append(c, n);
});
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(800);
await page.screenshot({ path: out, type: 'jpeg', quality: 88, clip: { x: 0, y: 0, width: 1200, height: 630 } });
console.log('wrote', out, errors.length ? `page errors: ${errors.slice(0, 3).join(' | ')}` : '');
await browser.close();
