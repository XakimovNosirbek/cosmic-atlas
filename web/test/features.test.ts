import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  X_ISCO, X_PHOTON, kerrDiskOmega, kerrHorizon, kerrIsco, kerrPhotonPrograde,
} from '../src/blackhole/physics';
import {
  CMB_DIPOLE_B_DEG, CMB_DIPOLE_L_DEG, CMB_DIPOLE_V_KMS, cmbComovingDistancePc, cmbRestRedshift,
} from '../src/math/cosmology';
import { normName } from '../src/data/resolve';
import { CONSTELLATIONS, zenithViewForObserver } from '../src/render/constellations';
import { computeMeasure } from '../src/ui/measure';
import { blackHoleScaleSvg, exoplanetScaleSvg, starHrSvg } from '../src/ui/miniViz';
import { LAYER_PRESETS } from '../src/ui/presets';
import { QUICK_DESTS } from '../src/ui/quickjump';
import { observerGalacticXyz, observerGeocentricPc } from '../src/solar/ephemeris';
import { NavController } from '../src/nav/controller';

describe('Kerr black hole physics (Bardeen–Press–Teukolsky 1972)', () => {
  it('reduces identically to Schwarzschild at spin a* = 0', () => {
    expect(kerrHorizon(0)).toBe(1);
    expect(kerrIsco(0)).toBe(X_ISCO);
    expect(kerrPhotonPrograde(0)).toBe(X_PHOTON);
    for (const x of [3, 6, 12]) {
      expect(kerrDiskOmega(x, 0)).toBeCloseTo(Math.sqrt(0.5 / (x * x * x)), 12);
    }
  });

  it('matches textbook prograde Kerr horizon, ISCO, and photon orbit at a* = 0.5 and 0.998', () => {
    // r_+ / r_s = (1 + sqrt(1 - a*^2)) / 2
    expect(kerrHorizon(0.5)).toBeCloseTo((1 + Math.sqrt(0.75)) / 2, 6);
    expect(kerrHorizon(0.998)).toBeCloseTo(0.5316, 4);
    // r_ISCO / (2M): a* = 0.5 -> 4.23300 / 2 = 2.11650; a* = 0.998 -> 1.23697 / 2 = 0.61849
    expect(kerrIsco(0.5)).toBeCloseTo(2.1165, 4);
    expect(kerrIsco(0.998)).toBeCloseTo(0.6185, 3);
    // Prograde photon orbit: a* = 0.5 -> 2.34730 / 2 = 1.17365
    expect(kerrPhotonPrograde(0.5)).toBeCloseTo(1.17365, 4);
    expect(kerrPhotonPrograde(0.998)).toBeLessThan(kerrIsco(0.998));
    expect(kerrHorizon(0.998)).toBeLessThan(kerrPhotonPrograde(0.998));
  });
});

describe('Planck 2018 CMB rest-frame dipole correction', () => {
  it('increases z_CMB toward the apex by +v_sun/c and decreases it toward the anti-apex', () => {
    const beta = CMB_DIPOLE_V_KMS / 299792.458;
    const zApex = cmbRestRedshift(0.01, CMB_DIPOLE_L_DEG, CMB_DIPOLE_B_DEG);
    const zAnti = cmbRestRedshift(0.01, (CMB_DIPOLE_L_DEG + 180) % 360, -CMB_DIPOLE_B_DEG);
    expect(zApex - 0.01).toBeCloseTo(1.01 * beta, 5);
    expect(zAnti - 0.01).toBeCloseTo(-1.01 * beta, 5);
  });

  it('gives zero CMB redshift for a CMB-stationary object along the apex', () => {
    const beta = CMB_DIPOLE_V_KMS / 299792.458;
    const zHelio = Math.sqrt((1 - beta) / (1 + beta)) - 1;
    expect(cmbRestRedshift(zHelio, CMB_DIPOLE_L_DEG, CMB_DIPOLE_B_DEG)).toBeCloseTo(0, 12);
    expect(cmbComovingDistancePc(zHelio, CMB_DIPOLE_L_DEG, CMB_DIPOLE_B_DEG)).toBeCloseTo(0, 6);
  });
});

describe('3D Distance Measurer', () => {
  it('computes exact Euclidean distance, light time, and Voyager 1 travel time', () => {
    const r = computeMeasure([0, 0, 0], [3, 4, 0]);
    expect(r.distPc).toBeCloseTo(5, 10);
    expect(r.distText).toContain('5');
    expect(r.lightText).toBeTruthy();
    // 5 pc at 17 km/s = 5 * 3.0857e13 / (17 * 3.1558e7) = 287,586 yr -> 287.6 kyr
    expect(r.voyagerText).toMatch(/287[.,]6/);
  });
});

describe('Mini SVG diagrams', () => {
  it('renders HR diagram, black hole horizon scale, and exoplanet orbital period SVGs with escaping', () => {
    const hr = starHrSvg(0.82, 4.67, 'Sun <test>');
    expect(hr).toContain('<svg');
    expect(hr).toContain('Sun &lt;test&gt;');
    expect(starHrSvg(NaN, 4, 'X')).toBeNull();

    const bh = blackHoleScaleSvg(4.297e6, 'Sgr A*');
    expect(bh).toContain('<svg');
    expect(bh).toContain('Sgr A*');
    expect(blackHoleScaleSvg(0, 'Zero')).toBeNull();

    const exo = exoplanetScaleSvg([
      { pl_name: 'TRAPPIST-1 b', pl_orbper: [1.51, 0.001], pl_rade: [1.116, 0.014] },
      { pl_name: 'TRAPPIST-1 e', pl_orbper: 6.1, pl_rade: 0.92 },
    ]);
    expect(exo).toContain('<svg');
    expect(exo).toContain('TRAPPIST-1 e');
    expect(exoplanetScaleSvg([{ pl_name: 'NoPeriod' }])).toBeNull();
  });
});

describe('3D Constellations & Night Sky zenith view', () => {
  it('resolves every single constellation star in named-stars.json', () => {
    const starsPath = resolve(__dirname, '../../data/tiles/catalogs/named-stars.json');
    const entries = JSON.parse(readFileSync(starsPath, 'utf8')) as { name: string; alt?: string[]; xyz: number[] | null }[];
    const known = new Set<string>();
    for (const e of entries) {
      if (!e.xyz) continue;
      known.add(normName(e.name));
      for (const a of e.alt ?? []) known.add(normName(a));
    }
    const missing: string[] = [];
    for (const c of CONSTELLATIONS) {
      for (const poly of c.lines) {
        for (const s of poly) {
          if (!known.has(normName(s))) missing.push(`${c.iau}:${s}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('places the camera right above the observer looking straight along the local zenith', () => {
    const t = Date.UTC(2026, 5, 21, 22, 0, 0);
    const v = zenithViewForObserver(41.31, 69.28, t); // Tashkent
    const surf = observerGalacticXyz(41.31, 69.28, 0, t);
    const upRaw = observerGeocentricPc(41.31, 69.28, 0, t);
    const upLen = Math.hypot(...upRaw);
    const up = upRaw.map((c) => c / upLen);
    const dir = NavController.dir(v.yaw, v.pitch);
    // Camera sits at focus + dist * dir, looking along -dir = +up (zenith)
    const look = dir.map((c) => -c);
    const dotZenith = look[0] * up[0] + look[1] * up[1] + look[2] * up[2];
    expect(dotZenith).toBeCloseTo(1, 6);
    const cam = [0, 1, 2].map((k) => v.focus[k] + v.dist * dir[k]);
    const altPc = Math.hypot(cam[0] - surf[0], cam[1] - surf[1], cam[2] - surf[2]);
    // Altitude above Earth surface is ~120 km (~3.9e-12 pc)
    expect(altPc).toBeGreaterThan(1e-12);
    expect(altPc).toBeLessThan(1e-10);
  });
});

describe('Quick-Jump & Layer Presets configuration', () => {
  it('has unique ids and valid i18n keys', () => {
    expect(new Set(QUICK_DESTS.map((d) => d.id)).size).toBe(QUICK_DESTS.length);
    expect(new Set(LAYER_PRESETS.map((p) => p.id)).size).toBe(LAYER_PRESETS.length);
    expect(LAYER_PRESETS[0].reset).toBe(true);
  });
});
