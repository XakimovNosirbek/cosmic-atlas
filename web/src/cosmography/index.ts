/**
 * Cosmography feature: the supergalactic grid, the CF4++ density volume and flow streamlines with
 * the Laniakea basins, and the 2MRS galaxy groups. main.ts talks to it through a handful of marked
 * hooks ("--- Cosmography hook"); everything else lives here.
 *
 * Layers (web/public/layers.json):
 *   type "sg-grid"        SGX/SGY/SGZ axes, the supergalactic plane, distance rings (sggrid.ts)
 *   type "cf4-density"    the CF4++ density contrast as a glowing volume (volume.ts)
 *   type "cf4-flow"       streamlines of the CF4++ velocity field, coloured by basin (streams.ts)
 *   type "galaxy-groups"  2MRS groups (Tully 2015), `data` = groups-2mrs.json in tiles/catalogs/
 * The two CF4 layers share `path` (tiles/cosmography: meta.json, density_rg8.bin, basins_u8.bin,
 * streams.bin; scripts/build_cosmography.py) and one SG frame group: rotation SG → Galactic and the
 * map scale (data.ts, 1 h⁻¹ Mpc = 1 / 0.6766 Mpc).
 */

import * as THREE from 'three/webgpu';
import type { CatalogEntry, ModelLayerConfig } from '../data/manifest';
import { fetchJson } from '../data/tilebase';
import { fmtFixed, t, tOr } from '../i18n';
import { galToLB, type Vec3 } from '../math/frames';
import { formatDistance } from '../math/units';
import { GLYPH, MarkerSet } from '../messengers/markers';
import { kindColor } from '../objects/kinds';
import type { LabelItem } from '../render/labels';
import { CosmoGrid, cf4ScalePc, groupEntries, groupSizePx, parseStreams, type CosmoMeta, type GroupEntry, type GroupsDoc } from './data';
import { GAL_TO_SG, galToSg, sgAxis } from './sgframe';
import { RING_MPC, SgGrid } from './sggrid';
import { StreamLines } from './streams';
import { DensityVolume } from './volume';

export interface CosmoHooks {
  scene: THREE.Scene;
  tileBase: () => string;
  dirty: () => void;
  rebuildLabels: () => void;
  renderPanel: () => void;
  /** fly to a view (labels of the grid) */
  fly: (v: { focus: Vec3; dist: number; yaw?: number; pitch?: number }) => void;
}

export interface PanelRow {
  id: string;
  title: string;
  swatch: string;
  meta: string;
  checked: boolean;
  opacity: number;
  onOpacity: (v: number) => void;
  loading?: boolean;
}

type Status = 'none' | 'loading' | 'ready' | 'missing' | 'error';

const smooth = (a: number, b: number, x: number) => {
  const u = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return u * u * (3 - 2 * u);
};

/** CF4 layers: on from ~10 Mpc of view distance, gone beyond ~20 Gpc */
export function cf4Fade(D: number): number {
  return smooth(4e6, 2e7, D) * (1 - smooth(8e9, 2e10, D));
}

/** group markers: from ~1 Mpc of view distance; they step aside beyond ~200 Mpc, where the flows take over */
export function groupFade(D: number): number {
  return smooth(5e5, 3e6, D) * (1 - smooth(1.5e8, 5e8, D));
}

interface Toggle {
  cfg: ModelLayerConfig | null;
  visible: boolean;
  opacity: number;
}

export class CosmographyFeature {
  readonly grid = new SgGrid();
  /** SG axes + map scale, placed at −camera each frame; holds the volume and the streamlines */
  private readonly frame = new THREE.Group();
  readonly density: Toggle = { cfg: null, visible: false, opacity: 1 };
  readonly flow: Toggle = { cfg: null, visible: false, opacity: 1 };
  gridCfg: ModelLayerConfig | null = null;
  groupsCfg: ModelLayerConfig | null = null;
  readonly groups = new MarkerSet('galaxy-groups', kindColor('galaxy_group'));
  groupEntries: GroupEntry[] = [];
  groupsStatus: Status = 'none';
  status: Status = 'none';
  error = '';
  meta: CosmoMeta | null = null;
  cpu: CosmoGrid | null = null;
  volume: DensityVolume | null = null;
  streams: StreamLines | null = null;
  private loading: Promise<void> | null = null;
  private amounts = { density: 0, flow: 0, groups: 0 };

  constructor(private readonly h: CosmoHooks) {
    this.frame.name = 'cosmography-sg';
    this.frame.frustumCulled = false;
    const m = GAL_TO_SG;
    this.frame.quaternion.setFromRotationMatrix(new THREE.Matrix4().set(m[0], m[3], m[6], 0, m[1], m[4], m[7], 0, m[2], m[5], m[8], 0, 0, 0, 0, 1));
    this.groups.visible = false;
    h.scene.add(this.grid.group, this.frame, this.groups.group);
  }

  claims(cfg: { type?: string }): boolean {
    return cfg.type === 'sg-grid' || cfg.type === 'cf4-density' || cfg.type === 'cf4-flow' || cfg.type === 'galaxy-groups';
  }

  addLayer(cfg: ModelLayerConfig, vis?: boolean) {
    const on = vis ?? cfg.visible;
    const type = cfg.type as string;
    if (type === 'sg-grid') {
      this.gridCfg = cfg;
      this.grid.visible = on;
    } else if (type === 'cf4-density') {
      this.density.cfg = cfg;
      this.density.visible = on;
    } else if (type === 'cf4-flow') {
      this.flow.cfg = cfg;
      this.flow.visible = on;
    } else if (type === 'galaxy-groups') {
      this.groupsCfg = cfg;
      this.groups.visible = on;
    }
    if (on && (type === 'cf4-density' || type === 'cf4-flow')) void this.load();
  }

  config(id: string): ModelLayerConfig | undefined {
    return [this.gridCfg, this.density.cfg, this.flow.cfg, this.groupsCfg].find((c) => c?.id === id) ?? undefined;
  }

  // ------------------------------------------------------------------ data

  /** meta.json + the three binaries (6.8 MB), once, when a CF4 layer is first shown */
  load(): Promise<void> {
    this.loading ??= (async () => {
      const cfg = this.density.cfg ?? this.flow.cfg;
      if (!cfg) return;
      const base = (cfg.path ?? 'tiles/cosmography').replace(/\/$/, '');
      this.status = 'loading';
      this.h.renderPanel();
      try {
        const r = await fetchJson<CosmoMeta>(`${base}/meta.json`);
        if (r.status !== 'ok') {
          this.status = 'missing';
          return;
        }
        const meta = r.data;
        const get = async (f: string) => {
          const res = await fetch(`${base}/${f}`);
          if (!res.ok) throw new Error(`${f}: HTTP ${res.status}`);
          return res.arrayBuffer();
        };
        const [rg, bs, st] = await Promise.all([get(meta.density.file), get(meta.basins.file), get(meta.streams.file)]);
        this.meta = meta;
        this.cpu = new CosmoGrid(meta, new Uint8Array(rg), new Uint8Array(bs));
        this.volume = new DensityVolume(meta, this.cpu.rg, this.cpu.basins);
        this.streams = new StreamLines(parseStreams(st, meta.streams.lines, meta.streams.vertices));
        const s = meta.grid.box_h_mpc * meta.toMap.pcPerUnit;
        this.volume.mesh.scale.setScalar(s);
        this.streams.mesh.scale.setScalar(meta.toMap.pcPerUnit);
        this.frame.add(this.volume.mesh, this.streams.mesh);
        this.status = 'ready';
      } catch (e) {
        this.status = 'error';
        this.error = (e as Error).message;
        console.error(`[cosmography] ${this.error}`);
      } finally {
        this.h.renderPanel();
        this.h.dirty();
      }
    })();
    return this.loading;
  }

  /** groups-2mrs.json → markers + catalogue entries (pushed to `catalog` for search) */
  async attachCatalog(catalog: CatalogEntry[]) {
    const cfg = this.groupsCfg;
    if (!cfg?.data) return;
    this.groupsStatus = 'loading';
    const r = await fetchJson<GroupsDoc>(`${this.h.tileBase()}catalogs/${cfg.data}`);
    if (r.status !== 'ok' || !Array.isArray(r.data?.rows)) {
      this.groupsStatus = r.status === 'ok' ? 'error' : 'missing';
      this.h.renderPanel();
      return;
    }
    const named = new Map<number, CatalogEntry>();
    for (const e of catalog) {
      const nest = (e as unknown as { nest?: number }).nest;
      if (e.kind === 'galaxy_group' && nest) named.set(nest, e);
    }
    this.groupEntries = groupEntries(r.data, named);
    this.groups.set3D(this.groupEntries.map((e) => ({
      entry: e, xyz: e.xyz as Vec3, glyph: GLYPH.ring, sizePx: groupSizePx(e.members.length), weight: named.has(e.nest) ? 1 : 0.4,
    })));
    for (const e of this.groupEntries) if (!named.has(e.nest)) catalog.push(e);
    this.groupsStatus = 'ready';
    this.h.renderPanel();
    this.h.dirty();
  }

  /** catalogue labels this feature suppresses: unnamed groups always, its kinds while their layer is off */
  hidesLabel(e: CatalogEntry): boolean {
    if (e.kind === 'galaxy_group') return !this.groups.visible || !(e.alt ?? []).length || /group$/.test(e.name);
    if (e.kind === 'supercluster' || e.kind === 'attractor') return !this.density.visible && !this.flow.visible && !this.grid.visible;
    return false;
  }

  /** SG axis and ring labels (rebuilt by main.ts with the other labels) */
  labelItems(): LabelItem[] {
    if (!this.grid.visible) return [];
    const out: LabelItem[] = [];
    const ax = ['SGX', 'SGY', 'SGZ'];
    for (const R of RING_MPC) {
      const pc = R * 1e6;
      // ring label on the +SGX side, slightly inside the ring
      const x = sgAxis(0);
      const y = sgAxis(1);
      const p: Vec3 = [0, 1, 2].map((k) => pc * (0.966 * x[k] + 0.259 * y[k])) as Vec3;
      out.push({ name: formatDistance(pc, 2), xyz: p, kind: 'sg_grid', absMag: null, minScale: pc / 9, maxScale: pc * 1.6, context: true });
    }
    for (let i = 0; i < 3; i++) {
      for (const R of [10, 100, 1000]) {
        const a = sgAxis(i as 0 | 1 | 2);
        out.push({ name: ax[i], xyz: a.map((v) => v * R * 1e6 * 1.05) as Vec3, kind: 'sg_grid', absMag: null, minScale: R * 1e6 / 4, maxScale: R * 1e6 * 2.5, context: true });
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ panel

  panelRows(): PanelRow[] {
    const rows: PanelRow[] = [];
    const title = (c: ModelLayerConfig) => tOr(`layer.${c.id}`, c.title);
    const cred = (c: ModelLayerConfig) => (c.credit ? `. ${c.credit}` : '');
    if (this.gridCfg) {
      const g = this.grid;
      rows.push({ id: this.gridCfg.id, title: title(this.gridCfg), swatch: 'sg', meta: `${t('layers.sgMeta')}${cred(this.gridCfg)}`,
        checked: g.visible, opacity: g.opacity, onOpacity: (v) => (g.opacity = v) });
    }
    const loading = this.status === 'loading';
    const h0 = this.meta ? fmtFixed(this.meta.scale.H0_cf4, 1) : '75.0';
    for (const [tg, sw, key] of [[this.density, 'cf4d', 'layers.cf4DensityMeta'], [this.flow, 'cf4f', 'layers.cf4FlowMeta']] as const) {
      if (!tg.cfg) continue;
      if (this.status === 'missing' || this.status === 'error') continue;
      const n = this.meta?.streams.lines ?? 0;
      rows.push({ id: tg.cfg.id, title: title(tg.cfg), swatch: sw, loading,
        meta: `${loading ? t('layers.loading') : t(key, { n: fmtFixed(n, 0), h0 })}${cred(tg.cfg)}`,
        checked: tg.visible, opacity: tg.opacity, onOpacity: (v) => (tg.opacity = v) });
    }
    if (this.groupsCfg && this.groupsStatus !== 'missing' && this.groupsStatus !== 'error') {
      const s = this.groups;
      rows.push({ id: this.groupsCfg.id, title: title(this.groupsCfg), swatch: 'groups', loading: this.groupsStatus !== 'ready',
        meta: `${this.groupsStatus === 'ready' ? t('layers.groupsMeta', { n: fmtFixed(this.groupEntries.length, 0) }) : t('layers.loading')}${cred(this.groupsCfg)}`,
        checked: s.visible, opacity: s.opacity, onOpacity: (v) => (s.opacity = v) });
    }
    return rows;
  }

  /** titles of layers whose data are not built (the panel's "not built" line) */
  missing(): string[] {
    const out: string[] = [];
    const title = (c: ModelLayerConfig) => tOr(`layer.${c.id}`, c.title);
    if (this.status === 'missing' || this.status === 'error') for (const c of [this.density.cfg, this.flow.cfg]) if (c) out.push(title(c));
    if ((this.groupsStatus === 'missing' || this.groupsStatus === 'error') && this.groupsCfg) out.push(title(this.groupsCfg));
    return out;
  }

  credits(): string[] {
    return [this.gridCfg, this.density.cfg, this.flow.cfg, this.groupsCfg].filter((c): c is ModelLayerConfig => !!c?.credit)
      .map((c) => `${tOr(`layer.${c.id}`, c.title)}: ${c.credit}`);
  }

  // ------------------------------------------------------------------ visibility

  setVisible(id: string, on: boolean): boolean {
    if (this.gridCfg?.id === id) this.grid.visible = on;
    else if (this.density.cfg?.id === id) this.density.visible = on;
    else if (this.flow.cfg?.id === id) this.flow.visible = on;
    else if (this.groupsCfg?.id === id) this.groups.visible = on;
    else return false;
    if (on && (id === this.density.cfg?.id || id === this.flow.cfg?.id)) void this.load();
    this.h.rebuildLabels();
    this.h.dirty();
    return true;
  }

  visibility(): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    if (this.gridCfg) out[this.gridCfg.id] = this.grid.visible;
    if (this.density.cfg) out[this.density.cfg.id] = this.density.visible;
    if (this.flow.cfg) out[this.flow.cfg.id] = this.flow.visible;
    if (this.groupsCfg) out[this.groupsCfg.id] = this.groups.visible;
    return out;
  }

  defaults(): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    for (const c of [this.gridCfg, this.density.cfg, this.flow.cfg, this.groupsCfg]) if (c) out[c.id] = c.visible;
    return out;
  }

  // ------------------------------------------------------------------ per frame

  update(cam: Vec3, D: number, dpr: number) {
    this.grid.update(cam, D);
    const f = cf4Fade(D);
    this.amounts.density = this.density.visible && this.volume ? this.density.opacity * f : 0;
    this.amounts.flow = this.flow.visible && this.streams ? this.flow.opacity * f : 0;
    this.frame.visible = this.amounts.density > 0.002 || this.amounts.flow > 0.002;
    if (this.frame.visible) {
      this.frame.position.set(-cam[0], -cam[1], -cam[2]);
      if (this.volume && this.meta) {
        this.volume.mesh.visible = this.amounts.density > 0.002;
        this.volume.uAmount.value = this.amounts.density;
        // camera in box units: R^T-free, since the box lives in the SG frame: sg(cam) / box edge (pc)
        const s = galToSg(cam);
        const box = this.meta.grid.box_h_mpc * this.meta.toMap.pcPerUnit;
        this.volume.uCam.value.set(s[0] / box, s[1] / box, s[2] / box);
      }
      if (this.streams) {
        this.streams.mesh.visible = this.amounts.flow > 0.002;
        this.streams.uAmount.value = this.amounts.flow;
        this.streams.uDpr.value = dpr;
      }
    }
    const gf = groupFade(D);
    this.amounts.groups = gf;
    const op = this.groups.opacity;
    this.groups.opacity = op * gf;
    this.groups.update(cam, 0);
    this.groups.opacity = op;
  }

  pickAt(x: number, y: number, cam: Vec3, camera: THREE.PerspectiveCamera, w: number, h: number): CatalogEntry | null {
    if (this.amounts.groups < 0.05 || !this.groups.visible) return null;
    return this.groups.pickAt(x, y, cam, camera, w, h, 8)?.entry ?? null;
  }

  // ------------------------------------------------------------------ info cards

  /** extra info-card rows for entries this feature owns (group members, the CF4-scale distance) */
  cardRows(e: CatalogEntry): [string, string][] {
    const rows: [string, string][] = [];
    const g = e as Partial<GroupEntry>;
    if (e.kind === 'galaxy_group' && g.members) {
      const names = g.members.slice(0, 12).map((m) => m[1] ?? `PGC ${m[0]}`);
      const more = g.members.length - names.length;
      rows.push([t('cosmo.row.members'), `${names.join(', ')}${more > 0 ? ` ${t('cosmo.val.more', { n: more })}` : ''}`]);
      rows.push([t('cosmo.row.distBasis'), t('cosmo.val.distRedshift')]);
    }
    if ((e.kind === 'supercluster' || e.kind === 'attractor') && e.dist_pc > 0 && this.meta) {
      rows.push([t('cosmo.row.cf4Scale'), t('cosmo.val.cf4Scale', { d: formatDistance(cf4ScalePc(e.dist_pc, this.meta), 3), h0: fmtFixed(this.meta.scale.H0_cf4, 1) })]);
    }
    return rows;
  }

  /** the overdensity under a click (camera position and unit ray, contract frame), as an info card */
  pickVolume(cam: Vec3, dir: Vec3) {
    if (!this.cpu || !this.meta || this.amounts.density < 0.05) return null;
    const hit = this.cpu.pick(cam, dir);
    if (!hit) return null;
    const m = this.meta;
    const d = Math.hypot(...hit.mapPc);
    const basin = hit.basin ? m.basins.names[String(hit.basin)] : null;
    const lb = galToLB(hit.mapPc);
    const f1 = (x: number) => fmtFixed(x, 1);
    const rows: [string, string][] = [
      [t('cosmo.row.delta'), t('cosmo.val.delta', { d: fmtFixed(hit.delta, 2), s: fmtFixed(hit.std, 2) })],
      [t('cosmo.row.basin'), basin ? tOr(`cosmo.basin.${basin}`, basin) : t('cosmo.val.noBasin')],
      [t('row.distance'), formatDistance(d, 3)],
      [t('cosmo.row.cf4Scale'), t('cosmo.val.cf4Scale', { d: formatDistance(cf4ScalePc(d, m), 3), h0: fmtFixed(m.scale.H0_cf4, 1) })],
      [t('cosmo.row.sg'), `${f1(hit.sg[0])}, ${f1(hit.sg[1])}, ${f1(hit.sg[2])} h⁻¹ Mpc`],
      [t('row.galactic'), `${fmtFixed(lb.l, 1)}°, ${fmtFixed(lb.b, 1)}°`],
    ];
    return {
      kind: t('cosmo.kind.density'), title: basin ? t('cosmo.title.in', { basin: tOr(`cosmo.basin.${basin}`, basin) }) : t('cosmo.title'),
      rows, note: t('cosmo.note', { cite: m.citation }), fly: { focus: hit.mapPc, dist: 1.2e8 },
      links: [[t('cosmo.link.cf4pp'), 'https://doi.org/10.1051/0004-6361/202553677'], [t('cosmo.link.basins'), 'https://doi.org/10.1051/0004-6361/202346802']] as [string, string][],
    };
  }

  debug() {
    return {
      status: this.status, error: this.error, groupsStatus: this.groupsStatus, groups: this.groupEntries.length,
      amounts: { ...this.amounts, grid: this.grid.amount },
      visible: this.visibility(),
      streams: this.streams ? { segments: this.streams.segments } : null,
      meta: this.meta ? { scale: this.meta.scale, toMap: this.meta.toMap } : null,
    };
  }
}
