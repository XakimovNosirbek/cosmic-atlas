/**
 * Data-driven, scientifically honest mini SVG diagrams for the Info Card:
 *   1. Stars (measured BP-RP colour & absolute G magnitude): Hertzsprung-Russell position vs Sun.
 *   2. Black holes (measured mass -> Schwarzschild diameter 2 r_s): log-scale ruler vs Earth, Sun,
 *      Earth's orbit (1 AU), Neptune's orbit (30 AU), and Voyager 1 (172 AU).
 *   3. Exoplanet systems (measured orbital semi-major axes in AU): log-scale comparison vs
 *      Mercury, Venus, Earth, Mars, and Jupiter.
 *
 * Pure string builders (escaped text only) so they are trivially unit-testable in Node.
 */

import { escapeHtml } from '../docs/markdown';
import { t } from '../i18n';
import { schwarzschildRadiusM } from '../blackhole/physics';
import type { FactValue, Planet } from '../objects/facts';

const AU_M = 1.495978707e11;

/** clamp value to [lo, hi] */
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** extract leading numeric value from a catalogue FactValue (number or [val, ...]) */
function factNum(v: FactValue | undefined): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (Array.isArray(v) && typeof v[0] === 'number' && Number.isFinite(v[0])) return v[0];
  return null;
}

/**
 * Mini HR diagram for a star with measured Gaia BP-RP colour and absolute magnitude M_G.
 * Axes: x = BP-RP (-0.5 .. 4.5), y = M_G (-6 .. 16, brighter at top).
 */
export function starHrSvg(bpRp: number, absG: number, starLabel: string): string | null {
  if (!Number.isFinite(bpRp) || !Number.isFinite(absG)) return null;
  const W = 280;
  const H = 104;
  const xOf = (c: number) => 22 + ((clamp(c, -0.5, 4.5) + 0.5) / 5.0) * (W - 36);
  const yOf = (m: number) => 12 + ((clamp(m, -6, 16) + 6) / 22) * (H - 28);
  // Schematic Gaia DR3 main sequence, giant branch, and white-dwarf band (display context only)
  const ms = [[-0.3, -3.5], [0.0, 0.5], [0.5, 3.2], [0.82, 4.7], [1.4, 7.0], [2.4, 10.2], [3.8, 14.2]]
    .map(([c, m]) => `${xOf(c).toFixed(1)},${yOf(m).toFixed(1)}`).join(' ');
  const gb = [[0.9, 1.5], [1.3, 0.2], [1.8, -1.2], [2.8, -2.5]]
    .map(([c, m]) => `${xOf(c).toFixed(1)},${yOf(m).toFixed(1)}`).join(' ');
  const wd = [[-0.2, 10.5], [0.3, 12.2], [1.0, 14.5]]
    .map(([c, m]) => `${xOf(c).toFixed(1)},${yOf(m).toFixed(1)}`).join(' ');
  const sx = xOf(0.82);
  const sy = yOf(4.67);
  const px = xOf(bpRp);
  const py = yOf(absG);
  return `<div class="miniviz" role="img" aria-label="${escapeHtml(t('viz.hr.label'))}">
    <p class="viz-cap">${escapeHtml(t('viz.hr.title'))}</p>
    <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
      <defs><linearGradient id="hr-grad" x1="0" x2="1"><stop offset="0%" stop-color="#9ec5ff"/><stop offset="30%" stop-color="#fff4e0"/><stop offset="65%" stop-color="#ffc278"/><stop offset="100%" stop-color="#ff7a59"/></linearGradient></defs>
      <rect x="22" y="12" width="${W - 36}" height="${H - 28}" fill="rgba(255,255,255,0.025)" stroke="rgba(255,255,255,0.12)" rx="4"/>
      <polyline points="${ms}" fill="none" stroke="url(#hr-grad)" stroke-width="5" stroke-linecap="round" stroke-opacity="0.28"/>
      <polyline points="${gb}" fill="none" stroke="#ffb06b" stroke-width="4" stroke-linecap="round" stroke-opacity="0.24"/>
      <polyline points="${wd}" fill="none" stroke="#a6d1ff" stroke-width="3" stroke-linecap="round" stroke-opacity="0.24"/>
      <circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="2.8" fill="none" stroke="#9aa3b2" stroke-width="1.2"/>
      <text x="${(sx + 5).toFixed(1)}" y="${(sy + 3).toFixed(1)}" class="viz-dim">${escapeHtml(t('body.sun'))}</text>
      <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4.5" fill="#e2c48e" stroke="#04060b" stroke-width="1.3"/>
      <text x="${(px > W * 0.65 ? px - 7 : px + 7).toFixed(1)}" y="${(py < 24 ? py + 12 : py - 6).toFixed(1)}" text-anchor="${px > W * 0.65 ? 'end' : 'start'}" class="viz-hi">${escapeHtml(starLabel.slice(0, 18))}</text>
      <text x="22" y="${H - 4}" class="viz-ax">${escapeHtml(t('viz.hr.hot'))}</text>
      <text x="${W - 14}" y="${H - 4}" text-anchor="end" class="viz-ax">${escapeHtml(t('viz.hr.cool'))}</text>
    </svg>
  </div>`;
}

/**
 * Mini log-scale horizon diameter comparison for a black hole of mass `massMsun`.
 */
export function blackHoleScaleSvg(massMsun: number, name: string): string | null {
  if (!Number.isFinite(massMsun) || massMsun <= 0) return null;
  const diamM = 2 * schwarzschildRadiusM(massMsun);
  const W = 280;
  const H = 68;
  // log10(meters): 4 (10 km) .. 14.5 (~200 AU)
  const LO = 4.0;
  const HI = 14.5;
  const xOf = (m: number) => 12 + ((clamp(Math.log10(m), LO, HI) - LO) / (HI - LO)) * (W - 24);
  const refs: [number, string][] = [
    [1.2742e7, t('body.earth')],
    [1.3927e9, t('body.sun')],
    [2 * AU_M, '2 AU'],
    [60 * AU_M, '60 AU'],
  ];
  const bx = xOf(diamM);
  const marks = refs.map(([m, lbl]) => {
    const x = xOf(m);
    return `<line x1="${x.toFixed(1)}" y1="26" x2="${x.toFixed(1)}" y2="38" stroke="rgba(255,255,255,0.28)" stroke-width="1"/>
      <text x="${x.toFixed(1)}" y="51" text-anchor="middle" class="viz-dim">${escapeHtml(lbl)}</text>`;
  }).join('');
  return `<div class="miniviz" role="img" aria-label="${escapeHtml(t('viz.bh.label'))}">
    <p class="viz-cap">${escapeHtml(t('viz.bh.title'))}</p>
    <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
      <line x1="12" y1="32" x2="${W - 12}" y2="32" stroke="rgba(255,255,255,0.2)" stroke-width="2" stroke-linecap="round"/>
      <line x1="12" y1="32" x2="${bx.toFixed(1)}" y2="32" stroke="#c9a66b" stroke-width="3" stroke-linecap="round"/>
      ${marks}
      <circle cx="${bx.toFixed(1)}" cy="32" r="5" fill="#04060b" stroke="#e2c48e" stroke-width="2"/>
      <text x="${clamp(bx, 24, W - 24).toFixed(1)}" y="18" text-anchor="middle" class="viz-hi">${escapeHtml(name)} (2 r_s)</text>
    </svg>
  </div>`;
}

/**
 * Mini log-scale orbital period comparison for an exoplanet system vs Solar System planets
 * (Mercury 87.97 d, Earth 365.25 d, Jupiter 4332.6 d) using measured `pl_orbper` and `pl_rade`.
 */
export function exoplanetScaleSvg(planets: Planet[]): string | null {
  const withP = planets
    .map((p) => ({ p, per: factNum(p.pl_orbper), rad: factNum(p.pl_rade) }))
    .filter((x): x is { p: Planet; per: number; rad: number | null } => x.per !== null && x.per > 0);
  if (!withP.length) return null;
  const W = 280;
  const H = 68;
  // log10(days): -0.5 (~0.3 d) .. 4.3 (~20,000 d)
  const LO = -0.5;
  const HI = 4.3;
  const xOf = (d: number) => 12 + ((clamp(Math.log10(d), LO, HI) - LO) / (HI - LO)) * (W - 24);
  const refs: [number, string][] = [
    [87.97, t('body.mercury')],
    [365.25, t('body.earth')],
    [4332.6, t('body.jupiter')],
  ];
  const refHtml = refs.map(([d, lbl]) => {
    const x = xOf(d);
    return `<line x1="${x.toFixed(1)}" y1="30" x2="${x.toFixed(1)}" y2="42" stroke="rgba(143,178,207,0.45)" stroke-width="1"/>
      <text x="${x.toFixed(1)}" y="54" text-anchor="middle" class="viz-dim">${escapeHtml(lbl)}</text>`;
  }).join('');
  const dots = withP.map(({ p, per, rad }) => {
    const x = xOf(per);
    const r = rad !== null && rad > 0 ? clamp(2 + Math.log2(Math.max(1, rad)), 2.5, 6) : 3.5;
    return `<circle cx="${x.toFixed(1)}" cy="24" r="${r.toFixed(1)}" fill="#e2c48e" fill-opacity="0.88" stroke="#04060b" stroke-width="0.8"><title>${escapeHtml(p.pl_name)}</title></circle>`;
  }).join('');
  return `<div class="miniviz" role="img" aria-label="${escapeHtml(t('viz.exo.label'))}">
    <p class="viz-cap">${escapeHtml(t('viz.exo.title'))}</p>
    <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
      <line x1="12" y1="24" x2="${W - 12}" y2="24" stroke="rgba(255,255,255,0.22)" stroke-width="1.5"/>
      <circle cx="12" cy="24" r="3.5" fill="#fff0c4"/>
      ${refHtml}
      ${dots}
    </svg>
  </div>`;
}
