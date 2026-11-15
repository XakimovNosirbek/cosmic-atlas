/**
 * Numbers that black hole captions quote, computed (not typed in) from the catalogue mass with the
 * same physics as the HUD (blackhole/physics.ts), so the caption and the live readout agree.
 *
 *   {p_mass}   catalogue mass, Suns          {p_rs}     Schwarzschild radius, km
 *   {p_tidN}   tidal stretch across a 2 m body at N r_s, in g (N = 25, 6, 3, 15 for 1.5)
 *   {p_slowN}  far-away seconds per second of your clock at N r_s (hovering observer)
 */

import { fmtFixed, fmtMax, t } from '../i18n';
import { G0, schwarzschildRadiusM, tidalAccel, timeDilation } from '../blackhole/physics';

/** distances (r_s) the captions quote, and their placeholder suffixes */
export const BH_STOPS: [number, string][] = [[25, '25'], [6, '6'], [3, '3'], [1.5, '15']];

/** v rounded to `sig` significant digits */
export function roundSig(v: number, sig: number): number {
  if (v === 0 || !Number.isFinite(v)) return v;
  const p = Math.pow(10, sig - 1 - Math.floor(Math.log10(Math.abs(v))));
  return Math.round(v * p) / p;
}

const SUP: Record<string, string> = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };

/** a number for a caption: 2 significant digits, a×10⁻ⁿ below 0.001, grouped thousands */
export function fmtCaption(v: number): string {
  const r = roundSig(v, 2);
  if (Math.abs(r) < 1e-3) {
    const e = Math.floor(Math.log10(Math.abs(r)));
    return `${fmtMax(roundSig(r / 10 ** e, 2), 1)}×10${String(e).split('').map((c) => SUP[c] ?? c).join('')}`;
  }
  return fmtMax(r, r >= 10 ? 0 : 2);
}

/** a mass in Suns as words: "4.3 million", "6.5 billion", "32.7" */
export function fmtMass(m: number): string {
  if (m >= 1e9) return t('num.billion', { n: fmtMax(m / 1e9, 1) });
  if (m >= 1e6) return t('num.million', { n: fmtMax(m / 1e6, 1) });
  return fmtMax(m, 1);
}

/** a length in km: "97", "12.7 million" */
export function fmtKm(km: number): string {
  if (km >= 1e9) return t('num.billion', { n: fmtMax(roundSig(km / 1e9, 2), 1) });
  if (km >= 1e6) return t('num.million', { n: fmtMax(roundSig(km / 1e6, 3), 1) });
  return fmtMax(roundSig(km, 2), 0);
}

/** the raw numbers (SI / g), for tests */
export function bhNumbers(massMsun: number) {
  const rsM = schwarzschildRadiusM(massMsun);
  const tid: Record<string, number> = {};
  const slow: Record<string, number> = {};
  for (const [x, k] of BH_STOPS) {
    tid[k] = tidalAccel(rsM, x * rsM, 2) / G0;
    slow[k] = 1 / timeDilation(x);
  }
  return { rsKm: rsM / 1e3, tid, slow };
}

/** caption placeholders for one hole, prefixed (`bh3_mass`, `bh3_tid3`, ...) */
export function bhVars(prefix: string, massMsun: number): Record<string, string> {
  const n = bhNumbers(massMsun);
  const out: Record<string, string> = { [`${prefix}_mass`]: fmtMass(massMsun), [`${prefix}_rs`]: fmtKm(n.rsKm) };
  for (const [, k] of BH_STOPS) {
    out[`${prefix}_tid${k}`] = fmtCaption(n.tid[k]);
    out[`${prefix}_slow${k}`] = fmtFixed(n.slow[k], 2);
  }
  return out;
}
