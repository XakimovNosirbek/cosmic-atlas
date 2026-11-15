// Cosmography data: the distance-scale conversion, literature checkpoints, 2MRS groups, fades, and
// (when scripts/build_cosmography.py has run) the gitignored grids.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CosmoGrid, cf4ScalePc, groupEntries, mapPcToSgH, parseStreams, sgHToMapPc, type CosmoMeta, type GroupsDoc } from '../src/cosmography/data';
import { cf4Fade, groupFade } from '../src/cosmography';
import { circleSegs, gridSegs, ringFade } from '../src/cosmography/sggrid';
import { sgTopDownYawPitch } from '../src/cosmography/sgframe';
import { NAMED_VIEWS, SG_POLE } from '../src/search/aliases';
import { galToLB, radecDistToGal, type Vec3 } from '../src/math/frames';
import type { CatalogEntry } from '../src/data/manifest';

const DIR = resolve(__dirname, '../../data/tiles/cosmography');
const CATS = resolve(__dirname, '../../data/tiles/catalogs');
const meta = JSON.parse(readFileSync(resolve(DIR, 'meta.json'), 'utf8')) as CosmoMeta;
const cat = JSON.parse(readFileSync(resolve(CATS, 'cosmography.json'), 'utf8')) as (CatalogEntry & { nest?: number })[];
const entry = (n: string) => {
  const e = cat.find((x) => x.name === n);
  if (!e) throw new Error(`no ${n}`);
  return e;
};
const sepDeg = (a: Vec3, b: Vec3) => (Math.acos(Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / Math.hypot(...a) / Math.hypot(...b))) * 180) / Math.PI;
const files = [meta.density.file, meta.basins.file, meta.streams.file];
const haveBins = files.every((f) => existsSync(resolve(DIR, f)));

describe('cosmography: distance scale (h⁻¹ Mpc → Planck18 map)', () => {
  it('one conversion: 1 h⁻¹ Mpc = 1/0.6766 Mpc; the CF4 (H0 = 75) scale is 0.902 of the map', () => {
    expect(meta.toMap.h).toBeCloseTo(0.6766, 4);
    expect(meta.toMap.pcPerUnit).toBeCloseTo(1e6 / 0.6766, 0);
    expect(meta.scale.H0_cf4).toBe(75);
    expect(cf4ScalePc(1e8, meta) / 1e8).toBeCloseTo(0.6766 / 0.75, 3);
    const back = mapPcToSgH(sgHToMapPc([-62, -8, 39], meta), meta);
    [-62, -8, 39].forEach((v, k) => expect(back[k]).toBeCloseTo(v, 9));
  });
  it('the Great Attractor entry is the published Laniakea attractor; 98 Mpc at H0 = 75', () => {
    const ga = entry('Great Attractor').xyz!;
    const p = sgHToMapPc([-62, -8, 39], meta);
    for (let k = 0; k < 3; k++) expect(Math.abs(ga[k] - p[k])).toBeLessThan(1);
    expect((Math.hypot(...p) * meta.scale.cf4OverMap) / 1e6).toBeCloseTo(Math.hypot(-62, -8, 39) / 0.75, 0);
  });
});

describe('cosmography: positions against the literature', () => {
  it('Great Attractor (Dupuy & Courtois 2023: RA 263°, Dec −39°) lies 3° from the Galactic plane', () => {
    const ga = entry('Great Attractor').xyz!;
    expect(sepDeg(ga, radecDistToGal(263, -39, 1))).toBeLessThan(1.0);
    const lb = galToLB(ga);
    expect(lb.l).toBeGreaterThan(349);
    expect(Math.abs(lb.b)).toBeLessThan(4);
  });
  it('Shapley attractor lies toward the Shapley core Abell 3558 (SIMBAD 202.01°, −31.53°): within 10°', () => {
    const sh = entry('Shapley attractor');
    expect(sepDeg(sh.xyz!, radecDistToGal(202.0133, -31.5264, 1))).toBeLessThan(10);
    // published V_CMB 15,468 km/s vs A3558's heliocentric cz 13,874 km/s
    expect(Math.abs(Number(sh.facts!.vcmb_kms) / 13874 - 1)).toBeLessThan(0.15);
  });
  it('Virgo Cluster (2MRS nest 100002) is toward M87 and at the Mei et al. 2007 distance, 16.5 ± 1.1 Mpc', () => {
    const v = entry('Virgo Cluster');
    expect(sepDeg(v.xyz!, radecDistToGal(187.7059, 12.3911, 1))).toBeLessThan(2);
    expect(Math.abs(v.dist_pc / 1e6 - 16.5)).toBeLessThan(1.1);
    expect(Number(v.facts!.members_2mrs)).toBeGreaterThan(150);
  });
  it('Coma and Perseus are where their redshifts put them (Planck18 comoving)', () => {
    expect(Math.abs(entry('Coma Cluster').dist_pc / 1e6 / 103.3 - 1)).toBeLessThan(0.05);
    const per = entry('Perseus Cluster').dist_pc / 1e6;
    expect(per).toBeGreaterThan(70);
    expect(per).toBeLessThan(85);
  });
  it('the named views fall back to the catalogue positions; the SG preset is the de Vaucouleurs pole', () => {
    const pairs: [string, string][] = [['laniakea', 'Laniakea'], ['great-attractor', 'Great Attractor'], ['shapley', 'Shapley'], ['perseus-pisces', 'Perseus-Pisces'], ['coma-cluster', 'Coma Cluster']];
    for (const [view, name] of pairs) {
      const t = NAMED_VIEWS[view].target as { catalog: string[]; fallback: Vec3 };
      expect(t.catalog).toContain(name);
      for (let k = 0; k < 3; k++) expect(Math.abs(t.fallback[k] - entry(name).xyz![k])).toBeLessThan(2);
    }
    const { yaw, pitch } = sgTopDownYawPitch();
    expect((yaw * 180) / Math.PI).toBeCloseTo(SG_POLE.yawDeg, 9);
    expect((pitch * 180) / Math.PI).toBeCloseTo(SG_POLE.pitchDeg, 9);
    expect(NAMED_VIEWS.supergalactic.yawDeg).toBe(SG_POLE.yawDeg);
  });
});

describe('cosmography: 2MRS groups', () => {
  const doc = JSON.parse(readFileSync(resolve(CATS, 'groups-2mrs.json'), 'utf8')) as GroupsDoc;
  const named = new Map(cat.filter((e) => e.kind === 'galaxy_group' && e.nest).map((e) => [e.nest!, e as CatalogEntry]));
  const groups = groupEntries(doc, named);
  it('every group has ≥ 2 members and a position; named clusters keep their names', () => {
    expect(groups.length).toBe(doc.rows.length);
    expect(groups.length).toBeGreaterThan(6000);
    expect(groups.every((g) => g.members.length >= 2 && g.xyz!.every(Number.isFinite))).toBe(true);
    const virgo = groups.find((g) => g.nest === 100002)!;
    expect(virgo.name).toBe('Virgo Cluster');
    expect(virgo.members.slice(0, 12).map((m) => m[1])).toContain('M87');
  });
  it('masses: catalogue h⁻¹ M☉ divided by h = 0.6766 (Coma: 1.71e15 h⁻¹ M☉ in Tully 2015)', () => {
    const coma = groups.find((g) => g.nest === 100001)!;
    expect(Math.abs(Number(coma.facts!.mass_lum_msun) / (1.71e15 / 0.6766) - 1)).toBeLessThan(0.01);
    expect(coma.facts!.sigma_v_kms).toBe(886);
  });
});

describe('cosmography: layer fades and grid geometry', () => {
  it('fades', () => {
    expect(cf4Fade(1e6)).toBe(0);
    expect(cf4Fade(4e8)).toBe(1);
    expect(cf4Fade(3e10)).toBe(0);
    expect(groupFade(2e7)).toBe(1);
    expect(groupFade(1e9)).toBe(0);
    expect(ringFade(1e8, 4e8)).toBe(1);
    expect(ringFade(1e6, 4e8)).toBe(0);
  });
  it('rings and grid lines lie in the SG plane and inside their radius', () => {
    const c = circleSegs(5, 32);
    for (let i = 0; i < c.length; i += 3) {
      expect(c[i + 2]).toBe(0);
      expect(Math.hypot(c[i], c[i + 1])).toBeCloseTo(5, 9);
    }
    const g = gridSegs(1, 3.5);
    for (let i = 0; i < g.length; i += 3) expect(Math.hypot(g[i], g[i + 1])).toBeLessThanOrEqual(3.5 + 1e-9);
  });
});

describe.runIf(haveBins)('cosmography: built grids (gitignored binaries)', () => {
  const load = (f: string) => new Uint8Array(readFileSync(resolve(DIR, f)));
  const grid = haveBins ? new CosmoGrid(meta, load(meta.density.file), load(meta.basins.file)) : null;
  it('our position is in Laniakea; the published attractors lie in their own basins', () => {
    expect(grid!.basinAt([0, 0, 0])).toBe(1);
    expect(grid!.basinAt([-62, -8, 39])).toBe(1);
    expect(grid!.basinAt([47, -23, -31])).toBe(5);
    expect(grid!.basinAt([-141, 62, -16])).toBe(6);
  });
  it('the Shapley and Norma lines of sight peak at the clusters’ Hubble-flow distance (±1–3 voxels)', () => {
    const peak = (ra: number, dec: number, rmax: number) => {
      const u = radecDistToGal(ra, dec, 1);
      const k = meta.toMap.pcPerUnit;
      let best = { r: 0, d: -9 };
      for (let r = 1; r <= rmax; r += 0.5) {
        const d = grid!.sample(mapPcToSgH([u[0] * r * k, u[1] * r * k, u[2] * r * k], meta)).delta;
        if (d > best.d) best = { r, d };
      }
      return best;
    };
    // SIMBAD: Abell 3558 cz 13,874 km/s (138.7 h⁻¹ Mpc); Norma (Abell 3627) cz 4,841 km/s (48.4 h⁻¹ Mpc)
    const sh = peak(202.0133, -31.5264, 250);
    expect(sh.d).toBeGreaterThan(2);
    expect(Math.abs(sh.r - 138.7)).toBeLessThan(25);
    const no = peak(243.59375, -60.86861, 120);
    expect(no.d).toBeGreaterThan(1);
    expect(Math.abs(no.r - 48.4)).toBeLessThan(8);
  });
  it('streams.bin parses into the advertised lines', () => {
    const buf = readFileSync(resolve(DIR, meta.streams.file));
    const s = parseStreams(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), meta.streams.lines, meta.streams.vertices);
    expect(s.count.length).toBe(meta.streams.lines);
    expect([...s.seedBasin].filter((b) => b === 1).length).toBeGreaterThan(100);
  });
});
