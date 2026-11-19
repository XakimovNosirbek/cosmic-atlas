/**
 * Small stateless UI & formatting helpers extracted from main.ts so the core app orchestrator
 * stays focused on rendering, navigation, and layer coordination.
 */

import type { CatalogEntry, LayerConfig } from '../data/manifest';
import type { Resolved } from '../data/resolve';
import { decimalSep, fmtFixed, t, tOr } from '../i18n';
import { gwLinks } from '../objects/gw';
import type { SkyCoord } from '../search/coords';

export function smoothstep(a: number, b: number, x: number): number {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
}

/** "RA 83.82200°, Dec −5.39100°" or "l 209.010°, b −19.380°" */
export function skyCoordText(c: SkyCoord): string {
  const sg = (x: number) => `${x < 0 ? '−' : '+'}${fmtFixed(Math.abs(x), 4)}`;
  return c.frame === 'icrs' ? `RA ${fmtFixed(c.ra, 4)}°, Dec ${sg(c.dec)}°` : `l ${fmtFixed(c.l, 3)}°, b ${sg(c.b)}°`;
}

/** per-viewer UI preferences (panel open/closed); storage may be blocked, then nothing is remembered */
export function prefGet(k: string): string | null {
  try {
    return localStorage.getItem(`ca.${k}`);
  } catch {
    return null;
  }
}

export function prefSet(k: string, v: string) {
  try {
    localStorage.setItem(`ca.${k}`, v);
  } catch {
    /* private window or blocked storage */
  }
}

/** a small icon button that copies `text` and says so in its tooltip */
export function copyButton(text: string, label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'copy-btn';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/></svg>';
  b.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      b.classList.add('done');
      b.title = t('info.copied');
      setTimeout(() => {
        b.classList.remove('done');
        b.title = label;
      }, 1500);
    } catch {
      b.title = t('status.copyFailedPlain');
    }
  });
  return b;
}

/** a layer's title in the current language (layer.<id>), else the manifest's */
export function layerTitle(c: LayerConfig): string {
  return tOr(`layer.${c.id}`, c.title);
}

/** a layer's credit line in the current language (credit.<id>), else the manifest's; undefined if none */
export function layerCredit(c: LayerConfig): string | undefined {
  return c.credit === undefined ? undefined : tOr(`credit.${c.id}`, c.credit);
}

/** catalogue names stay as catalogued, except the Sun and the CMB shell, which are translated */
export function displayName(name: string): string {
  return name === 'Sun' ? t('body.sun') : name === 'CMB' ? t('cmb.label') : name;
}

/**
 * Numbers written with English separators (src/solar/info.ts) in the current language's form:
 * "6,371 km" -> "6 371 km", "0.9896" -> "0,9896" for uz/ru. Text without digits is untouched.
 */
export function localNums(s: string): string {
  const dec = decimalSep();
  if (dec === '.') return s;
  return s.replace(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+/g, (m) => m.replace(/,/g, '\u00a0').replace('.', dec));
}

/** Milky Way model label (src/render/milkyway.ts) -> i18n key */
export const MW_LABEL_KEYS: Record<string, string> = {
  '3-kpc arm': 'mw.3kpc', 'Norma arm': 'mw.norma', 'Scutum-Centaurus arm': 'mw.scutum', 'Sagittarius-Carina arm': 'mw.sagittarius',
  'Local arm': 'mw.local', 'Perseus arm': 'mw.perseus', 'Outer arm': 'mw.outer', 'Galactic bar': 'mw.bar',
};

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** where a Sesame distance came from, in the current language */
export function sesameSource(r: Resolved): string {
  const d = r.distInfo;
  if (d.method === 'parallax') return t('sesame.parallax', { plx: fmtFixed(d.plx, 3), err: fmtFixed(d.err, 3) });
  if (d.method === 'redshift') return t('sesame.redshift', { z: fmtFixed(d.z, 5) });
  if (d.method === 'lowz') return t('sesame.lowz', { z: fmtFixed(d.z, 5) });
  return t('sesame.none');
}

/** outbound links of a catalogue entry's info card */
export function catalogLinks(e: CatalogEntry): [string, string][] {
  const out: [string, string][] = [];
  if (e.kind === 'exoplanet') out.push([t('link.exoplanetArchive'), `https://exoplanetarchive.ipac.caltech.edu/overview/${encodeURIComponent(e.name)}`]);
  else if (e.kind === 'gw_event') out.push(...gwLinks(e));
  else if (e.name !== 'Sun' && e.kind !== 'message' && e.kind !== 'seti_signal' && e.kind !== 'cmb')
    out.push([t('link.simbad'), `https://simbad.cds.unistra.fr/simbad/sim-id?Ident=${encodeURIComponent(e.name)}`]);
  if (e.doi) out.push([t('link.doi'), `https://doi.org/${e.doi}`]);
  return out;
}
