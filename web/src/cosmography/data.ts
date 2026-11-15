/**
 * Cosmography data (scripts/build_cosmography.py → data/tiles/cosmography/ and catalogs/groups-2mrs.json):
 * the one distance-scale conversion, the streamline and grid decoders, the CPU sampler behind the
 * info card, and the 2MRS groups as catalogue entries. Pure (no GPU), unit-tested.
 *
 * DISTANCE SCALE. The CF4 grids are in h⁻¹ Mpc. CF4's own zero point gives H0 = 75.0 ± 0.35 km/s/Mpc
 * (Courtois et al. 2023, ungrouped CF4; 74.6 nominal, Tully et al. 2023); our redshift layers (DESI,
 * 2MRS, SDSS) use Planck18, h = 0.6766. A length L h⁻¹ Mpc is drawn as L / 0.6766 Mpc (meta.toMap),
 * where the Planck18 layers put galaxies of the same Hubble-flow velocity; the CF4-scale distance,
 * 0.902 times that, is shown next to it on the info card. Nothing is drawn at the H0 = 75 scale.
 */

import type { CatalogEntry } from '../data/manifest';
import { galToRadec, type Vec3 } from '../math/frames';
import { galToSg, sgToGal } from './sgframe';

export interface CosmoMeta {
  toMap: { pcPerUnit: number; h: number };
  scale: { hPlanck18: number; H0_cf4: number; H0_cf4_err: number; H0_cf4_nominal: number; cf4OverMap: number; ref: string };
  grid: { n: number; box_h_mpc: number; voxel_h_mpc: number; origin_h_mpc: [number, number, number] };
  density: { file: string; bytes: number; r: { lo: number; hi: number }; g: { lo: number; hi: number }; dataRadius_h_mpc: number };
  basins: { file: string; bytes: number; names: Record<string, string>; source: string };
  streams: { file: string; lines: number; vertices: number; agreement?: Record<string, unknown>; sinks?: unknown[] };
  citation: string;
  license: string;
}

/** basin label → display colour (sRGB hex); 0 = no basin */
export const BASIN_COLORS: Record<number, string> = {
  0: '#7d8696',
  1: '#ffa040', // Laniakea
  2: '#c58cff', // Apus
  3: '#55d6ff', // Hercules
  4: '#79f0a0', // Lepus
  5: '#5a8dff', // Perseus–Pisces
  6: '#ff6a9a', // Shapley
  7: '#a99fd6',
  8: '#a99fd6',
  9: '#a99fd6',
};

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** SG position in h⁻¹ Mpc → contract-frame pc at the map (Planck18) scale */
export function sgHToMapPc(sg: Vec3, meta: Pick<CosmoMeta, 'toMap'>): Vec3 {
  const k = meta.toMap.pcPerUnit;
  return sgToGal([sg[0] * k, sg[1] * k, sg[2] * k]);
}

/** contract-frame pc → SG h⁻¹ Mpc (inverse of sgHToMapPc) */
export function mapPcToSgH(p: Vec3, meta: Pick<CosmoMeta, 'toMap'>): Vec3 {
  const s = galToSg(p);
  const k = meta.toMap.pcPerUnit;
  return [s[0] / k, s[1] / k, s[2] / k];
}

/** a map distance (pc) at CF4's own scale (H0 = 75): × h_Planck18 / 0.75 */
export function cf4ScalePc(mapPc: number, meta: Pick<CosmoMeta, 'scale'>): number {
  return mapPc * meta.scale.cf4OverMap;
}

export interface Streams {
  /** SG h⁻¹ Mpc, 3 per vertex */
  pos: Float32Array;
  first: Uint32Array;
  count: Uint16Array;
  seedBasin: Uint8Array;
  endBasin: Uint8Array;
}

/** streams.bin: float32 xyz per vertex, then uint32 first, uint16 count, uint8 seed basin, uint8 end basin per line */
export function parseStreams(buf: ArrayBuffer, lines: number, vertices: number): Streams {
  const want = vertices * 12 + lines * (4 + 2 + 1 + 1);
  if (buf.byteLength !== want) throw new Error(`streams.bin: ${buf.byteLength} B, expected ${want}`);
  let o = 0;
  const pos = new Float32Array(buf, o, vertices * 3);
  o += vertices * 12;
  const first = new Uint32Array(buf.slice(o, o + lines * 4));
  o += lines * 4;
  const count = new Uint16Array(buf.slice(o, o + lines * 2));
  o += lines * 2;
  const seedBasin = new Uint8Array(buf, o, lines);
  o += lines;
  const endBasin = new Uint8Array(buf, o, lines);
  for (let i = 0; i < lines; i++) if (first[i] + count[i] > vertices) throw new Error(`streams.bin: line ${i} runs past the vertex array`);
  return { pos, first, count, seedBasin, endBasin };
}

/** the density + basin grids on the CPU (info card): trilinear δ / σ, nearest basin label */
export class CosmoGrid {
  readonly n: number;
  constructor(readonly meta: CosmoMeta, readonly rg: Uint8Array, readonly basins: Uint8Array) {
    this.n = meta.grid.n;
    if (rg.length !== this.n ** 3 * 2 || basins.length !== this.n ** 3) throw new Error('cosmography grids: wrong size');
  }

  private decode(c: number, ch: 0 | 1): number {
    const r = ch === 0 ? this.meta.density.r : this.meta.density.g;
    return r.lo + (c / 255) * (r.hi - r.lo);
  }

  /** continuous index of an SG position (voxel centre i at i) */
  private idx(sg: Vec3): Vec3 {
    const g = this.meta.grid;
    return [(sg[0] - g.origin_h_mpc[0]) / g.voxel_h_mpc - 0.5, (sg[1] - g.origin_h_mpc[1]) / g.voxel_h_mpc - 0.5, (sg[2] - g.origin_h_mpc[2]) / g.voxel_h_mpc - 0.5];
  }

  /** δ and its posterior std at an SG position (h⁻¹ Mpc), trilinear, clamped at the box */
  sample(sg: Vec3): { delta: number; std: number } {
    const n = this.n;
    const q = this.idx(sg).map((v) => Math.min(Math.max(v, 0), n - 1)) as Vec3;
    const i0 = q.map((v) => Math.min(Math.floor(v), n - 2));
    const f = q.map((v, k) => v - i0[k]);
    let d = 0;
    let s = 0;
    for (let c = 0; c < 8; c++) {
      const dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1;
      const w = (dx ? f[0] : 1 - f[0]) * (dy ? f[1] : 1 - f[1]) * (dz ? f[2] : 1 - f[2]);
      const j = (i0[0] + dx) + n * ((i0[1] + dy) + n * (i0[2] + dz));
      d += w * this.decode(this.rg[j * 2], 0);
      s += w * this.decode(this.rg[j * 2 + 1], 1);
    }
    return { delta: d, std: s };
  }

  basinAt(sg: Vec3): number {
    const n = this.n;
    const g = this.meta.grid;
    const i = sg.map((v, k) => Math.min(Math.max(Math.floor((v - g.origin_h_mpc[k]) / g.voxel_h_mpc), 0), n - 1));
    return this.basins[i[0] + n * (i[1] + n * i[2])];
  }

  /**
   * the densest point along a ray (camera position and unit direction, contract frame pc) inside the
   * data sphere, or null when the ray misses it or nothing there is overdense (δ < minDelta)
   */
  pick(cam: Vec3, dir: Vec3, minDelta = 0.5): { sg: Vec3; mapPc: Vec3; delta: number; std: number; basin: number } | null {
    const o = mapPcToSgH(cam, this.meta);
    const d = galToSg(dir);
    const R = this.meta.density.dataRadius_h_mpc;
    const b = o[0] * d[0] + o[1] * d[1] + o[2] * d[2];
    const c = o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - R * R;
    const disc = b * b - c;
    if (disc <= 0) return null;
    const t0 = Math.max(-b - Math.sqrt(disc), 0);
    const t1 = -b + Math.sqrt(disc);
    if (t1 <= t0) return null;
    const step = this.meta.grid.voxel_h_mpc / 2;
    let best: { sg: Vec3; delta: number; std: number } | null = null;
    for (let t = t0; t <= t1; t += step) {
      const p: Vec3 = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
      const v = this.sample(p);
      if (!best || v.delta > best.delta) best = { sg: p, ...v };
    }
    if (!best || best.delta < minDelta) return null;
    return { ...best, mapPc: sgHToMapPc(best.sg, this.meta), basin: this.basinAt(best.sg) };
  }
}

// ---------------------------------------------------------------------------- 2MRS groups

export interface GroupsDoc {
  version: number;
  h: number;
  fields: string[];
  rows: (number | string | null)[][];
  members: [number, string | null, number, number][][];
  memberFields: string[];
  ref: string;
  doi: string;
}

export interface GroupEntry extends CatalogEntry {
  nest: number;
  members: [number, string | null, number, number][];
}

/** groups-2mrs.json rows → catalogue entries (kind galaxy_group); `named` (cosmography.json, by nest) wins */
export function groupEntries(doc: GroupsDoc, named: Map<number, CatalogEntry>): GroupEntry[] {
  const F = Object.fromEntries(doc.fields.map((f, i) => [f, i]));
  const num = (r: (number | string | null)[], k: string) => (r[F[k]] === null ? null : Number(r[F[k]]));
  const out: GroupEntry[] = [];
  doc.rows.forEach((r, i) => {
    const nest = Number(r[F.nest]);
    const xyz: Vec3 = [Number(r[F.x]), Number(r[F.y]), Number(r[F.z])];
    const pre = named.get(nest);
    const members = doc.members[i] ?? [];
    const n = Number(r[F.n]);
    const h = doc.h;
    const facts: Record<string, number> = { members_2mrs: n };
    const ml = num(r, 'mlum_h12');
    const mv = num(r, 'mvir_h12');
    const sv = num(r, 'sigV');
    if (ml !== null && ml > 0) facts.mass_lum_msun = Number(((ml * 1e12) / h).toPrecision(3));
    if (mv !== null && mv > 0) facts.mass_vir_msun = Number(((mv * 1e12) / h).toPrecision(3));
    if (sv !== null) facts.sigma_v_kms = sv;
    facts.cz_helio_kms = Number(r[F.hv]);
    const brightest = members[0]?.[1] ?? `PGC ${r[F.pgc1]}`;
    if (pre) {
      const e = pre as GroupEntry;
      e.members = members;
      e.facts = { ...facts, ...(pre.facts ?? {}) };
      out.push(e);
      return;
    }
    const rd = galToRadec(xyz);
    out.push({
      name: `${brightest} group`, alt: [`2MRS nest ${nest}`, `PGC ${r[F.pgc1]} group`], kind: 'galaxy_group',
      ra: rd.ra, dec: rd.dec, dist_pc: Number(r[F.dist_pc]), xyz, docs: 'laniakea', facts,
      ref: `Tully 2015, AJ 149, 171 (2MRS nest ${nest})`, doi: doc.doi, nest, members,
    } as GroupEntry);
  });
  return out;
}

/** marker size (CSS px) from the group's member count: 5 px for a pair, 11 px for Virgo's 194 */
export function groupSizePx(n: number): number {
  return Math.min(14, 4 + 3 * Math.log10(Math.max(n, 2)));
}
