/**
 * Supergalactic grid: the SGX / SGY / SGZ axes, the supergalactic plane as a faint square grid and
 * distance rings in Mpc, the frame extragalactic maps are drawn in (Tully et al. 2014, Fig. 1).
 *
 * Geometry is built once in supergalactic axes (pc) and rotated into the contract frame by the
 * GAL_TO_SG matrix (sgframe.ts). Relative to eye like every other layer: group.position = −camera
 * (float64 on the CPU). Which rings and which grid spacing show depends on the camera's distance to
 * the focus D (gridFade / ringFade, unit-tested): rings of radius R from R ≈ D/30 to R ≈ 3 D, one
 * grid spacing s = 10^k Mpc between s ≈ D/40 and s ≈ D/1.5.
 *
 * 1-px additive lines, no depth test, drawn under the points (renderOrder −2): a guide, not data.
 */

import * as THREE from 'three/webgpu';
import { float, uniform, vec3, vec4 } from 'three/tsl';
import type { Vec3 } from '../math/frames';
import { GAL_TO_SG } from './sgframe';

const MPC = 1e6;
/** ring radii, Mpc (1-2-5 steps from 1 Mpc to 2 Gpc) */
export const RING_MPC = [1, 2, 5, 10, 20, 50, 100, 200, 300, 500, 1000, 2000];
/** square-grid spacings, Mpc */
export const GRID_MPC = [1, 10, 100, 1000];
/** linear colours of the SGX, SGY, SGZ axes (red, green, blue, as in Dupuy & Courtois 2023) */
export const AXIS_RGB: [number, number, number][] = [[0.9, 0.32, 0.28], [0.35, 0.85, 0.42], [0.36, 0.55, 1.0]];
const PLANE_RGB: [number, number, number] = [0.42, 0.55, 0.8];

const smooth = (a: number, b: number, x: number) => {
  const u = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return u * u * (3 - 2 * u);
};

/** brightness 0..1 of the ring of radius R (pc) at camera-to-focus distance D (pc), log-space window */
export function ringFade(R: number, D: number): number {
  const q = Math.log10(R / D);
  // fully on from R = D/10 to R = 1.5 D, gone below D/30 and beyond 3 D
  return smooth(-1.48, -1.0, q) * (1 - smooth(0.18, 0.48, q));
}

/** brightness 0..1 of the grid with spacing s (pc) at camera distance D (pc) */
export function gridFade(s: number, D: number): number {
  const q = Math.log10(s / D);
  return smooth(-1.6, -1.1, q) * (1 - smooth(-0.55, -0.18, q));
}

/** whole-layer fade with the camera's distance from the Sun: from the Local Group outward */
export function sgLayerFade(camFromSunPc: number, D: number): number {
  return smooth(3e5, 1.5e6, Math.max(camFromSunPc, D));
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

interface Part {
  obj: THREE.LineSegments;
  gain: N;
  /** 'ring' | 'grid' | 'axis' and its size in pc */
  type: 'ring' | 'grid' | 'axis';
  size: number;
}

function lineMat(rgb: [number, number, number], gain: N, base: number) {
  const m = new THREE.LineBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
  m.colorNode = vec4((vec3(rgb[0], rgb[1], rgb[2]) as N).mul(gain).mul(base), float(1));
  m.opacityNode = float(1);
  return m;
}

function segs(pts: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

/** circle of radius r in the SG plane (SGZ = 0) as line segments */
export function circleSegs(r: number, n = 192): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * 2 * Math.PI;
    const a1 = ((i + 1) / n) * 2 * Math.PI;
    out.push(r * Math.cos(a0), r * Math.sin(a0), 0, r * Math.cos(a1), r * Math.sin(a1), 0);
  }
  return out;
}

/** square grid of spacing s inside the disk of radius R (lines clipped to the circle) */
export function gridSegs(s: number, R: number): number[] {
  const out: number[] = [];
  const n = Math.floor(R / s);
  for (let i = -n; i <= n; i++) {
    const c = i * s;
    const h = Math.sqrt(Math.max(R * R - c * c, 0));
    if (h <= 0) continue;
    out.push(c, -h, 0, c, h, 0, -h, c, 0, h, c, 0);
  }
  return out;
}

export class SgGrid {
  readonly group = new THREE.Group();
  /** rotated into the contract frame; children are in SG axes */
  private readonly frame = new THREE.Group();
  private parts: Part[] = [];
  private readonly uLayer = uniform(1);
  visible = false;
  opacity = 1;
  /** last per-frame layer strength (debug) */
  amount = 0;

  constructor() {
    this.group.name = 'sg-grid';
    this.group.renderOrder = -2;
    this.group.frustumCulled = false;
    const m = GAL_TO_SG;
    // rows of GAL_TO_SG are the SG axes in Galactic coordinates → columns of the SG→Gal rotation
    const rot = new THREE.Matrix4().set(m[0], m[3], m[6], 0, m[1], m[4], m[7], 0, m[2], m[5], m[8], 0, 0, 0, 0, 1);
    this.frame.quaternion.setFromRotationMatrix(rot);
    this.group.add(this.frame);
    for (const r of RING_MPC) this.add('ring', r * MPC, circleSegs(r * MPC), PLANE_RGB, 0.22);
    for (const s of GRID_MPC) this.add('grid', s * MPC, gridSegs(s * MPC, s * MPC * 20), PLANE_RGB, 0.07);
    // axes: ±L along each SG axis, L = 2 Gpc; their brightness follows the view (see update)
    AXIS_RGB.forEach((rgb, i) => {
      const L = 2000 * MPC;
      const p = [0, 0, 0, 0, 0, 0];
      p[i] = -L;
      p[3 + i] = L;
      this.add('axis', L, p, rgb, 0.5);
    });
  }

  private add(type: Part['type'], size: number, pts: number[], rgb: [number, number, number], base: number) {
    const gain = uniform(0);
    const obj = new THREE.LineSegments(segs(pts), lineMat(rgb, (gain as N).mul(this.uLayer), base));
    obj.frustumCulled = false;
    obj.renderOrder = -2;
    this.frame.add(obj);
    this.parts.push({ obj, gain, type, size });
  }

  /** per frame: camera position (pc, contract frame) and its distance to the focus */
  update(cam: Vec3, D: number) {
    this.amount = this.visible ? this.opacity * sgLayerFade(Math.hypot(...cam), D) : 0;
    this.uLayer.value = this.amount;
    this.group.visible = this.amount > 0.002;
    if (!this.group.visible) return;
    this.group.position.set(-cam[0], -cam[1], -cam[2]);
    for (const p of this.parts) {
      const f = p.type === 'ring' ? ringFade(p.size, D) : p.type === 'grid' ? gridFade(p.size, D) : 1;
      p.gain.value = f;
      p.obj.visible = f > 0.003;
    }
  }

  /** rings drawn at this view distance (labels and tests) */
  ringsAt(D: number): number[] {
    return RING_MPC.filter((r) => ringFade(r * MPC, D) > 0.5);
  }
}
