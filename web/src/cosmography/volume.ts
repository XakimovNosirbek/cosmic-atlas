/**
 * CF4++ density as a glowing volume (emission only, additive, like the dust layer's "glow" look).
 *
 * The 128³ grid is SG-aligned (data.ts); the mesh is a unit box inside the layer's SG frame group,
 * which carries the SG → Galactic rotation and the map scale (1000 h⁻¹ Mpc → 1000 / 0.6766 Mpc).
 * Drawn from its back faces, so it also works with the camera inside the box. Per fragment the
 * ray from the camera (uCam, box units, computed in float64 on the CPU) to the back face is
 * clipped to the data sphere (r ≤ 300 h⁻¹ Mpc, where CF4++ has galaxies; beyond it the field is
 * the prior) and marched in VOLUME_STEPS (40) jittered samples:
 *
 *   I = Σ e(δ) · w(δ/σ) · ds,   e = smoothstep(δ0, δ1, δ),   w = smoothstep(1, 3, δ/σ)
 *
 * so only clear overdensities glow: δ from δ0 = 1.2 to δ1 = 2.8 (15 % of the top-down columns inside 300 h⁻¹ Mpc
 * reach δ > 1.5, 5 % δ > 2) that the reconstruction is sure of (δ at least 1–3 posterior σ). Colour:
 * a cool-to-white ramp in δ, mixed 45 % with the colour of the Dupuy & Courtois 2023 basin the
 * sample lies in (Laniakea orange, Shapley pink ...). A display aid: δ is the matter density
 * contrast of a linear-theory reconstruction smoothed to ~ 8 h⁻¹ Mpc voxels; it does not resolve
 * single clusters (Virgo: δ = 0.08 ± 0.11 at its position).
 */

import * as THREE from 'three/webgpu';
import {
  Break, Fn, If, Loop, dot, float, fract, int, max, min, mix, positionGeometry, screenCoordinate, select, smoothstep, sqrt,
  texture, texture3D, uniform, vec2, vec3, vec4,
} from 'three/tsl';
import { BASIN_COLORS, hexToRgb, type CosmoMeta } from './data';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

export const VOLUME_STEPS = 40;

export class DensityVolume {
  readonly mesh: THREE.Mesh;
  /** camera position in box units (box = [-0.5, 0.5]³ in SG axes) */
  readonly uCam = uniform(new THREE.Vector3());
  readonly uAmount = uniform(0);
  readonly uGain = uniform(0.6);
  readonly uD0 = uniform(1.2);
  readonly uD1 = uniform(2.8);
  private readonly rgTex: THREE.Data3DTexture;
  private readonly basinTex: THREE.Data3DTexture;

  constructor(meta: CosmoMeta, rg: Uint8Array, basins: Uint8Array) {
    const n = meta.grid.n;
    const mk = (data: Uint8Array, format: THREE.PixelFormat, filter: THREE.MagnificationTextureFilter) => {
      const t = new THREE.Data3DTexture(data, n, n, n);
      t.format = format;
      t.type = THREE.UnsignedByteType;
      t.minFilter = filter;
      t.magFilter = filter;
      t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
      t.unpackAlignment = 1;
      t.generateMipmaps = false;
      t.needsUpdate = true;
      return t;
    };
    this.rgTex = mk(rg, THREE.RGFormat, THREE.LinearFilter);
    this.basinTex = mk(basins, THREE.RedFormat, THREE.NearestFilter);
    // basin palette, linear RGB, 16 x 1
    const pal = new Uint8Array(16 * 4);
    for (let i = 0; i < 16; i++) {
      const c = hexToRgb(BASIN_COLORS[i] ?? BASIN_COLORS[0]);
      pal.set([c[0] * 255, c[1] * 255, c[2] * 255, 255], i * 4);
    }
    const palTex = new THREE.DataTexture(pal, 16, 1);
    palTex.colorSpace = THREE.SRGBColorSpace;
    palTex.minFilter = palTex.magFilter = THREE.NearestFilter;
    palTex.needsUpdate = true;

    const dLo = meta.density.r.lo;
    const dHi = meta.density.r.hi;
    const sLo = meta.density.g.lo;
    const sHi = meta.density.g.hi;
    const R = meta.density.dataRadius_h_mpc / meta.grid.box_h_mpc; // box units
    const boxMpc = (meta.grid.box_h_mpc / meta.toMap.h); // box edge, map Mpc
    const rgT = this.rgTex;
    const bT = this.basinTex;

    const mat = new THREE.MeshBasicNodeMaterial({
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
    });
    mat.colorNode = Fn(() => {
      const C = this.uCam;
      const P = positionGeometry; // back-face point, box units
      const dv = P.sub(C);
      const len = max(sqrt(dot(dv, dv)), 1e-9);
      const d = dv.div(len);
      // ray ∩ data sphere (centre 0, radius R); the back face bounds it on the far side
      const b = dot(C, d);
      const disc = b.mul(b).sub(dot(C, C).sub(R * R));
      const sq = sqrt(max(disc, 0.0));
      const t0 = max(b.negate().sub(sq), 0.0);
      const t1 = min(b.negate().add(sq), len);
      const valid = disc.greaterThan(0.0).and(t1.greaterThan(t0));
      const n = select(valid, int(VOLUME_STEPS), int(0));
      const dt = max(t1.sub(t0), 0.0).div(float(VOLUME_STEPS));
      const jit = fract(float(52.9829189).mul(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715)))));
      const acc = vec3(0.0).toVar();
      Loop({ start: int(0), end: n, type: 'int', condition: '<' }, ({ i }: { i: N }) => {
        const s = t0.add(float(i).add(jit).mul(dt));
        const p = C.add(d.mul(s));
        const q = p.add(0.5);
        If(q.x.lessThan(0.0).or(q.x.greaterThan(1.0)), () => {
          Break();
        });
        const rg = texture3D(rgT, q).level(float(0));
        const delta = rg.r.mul(dHi - dLo).add(dLo);
        const sig = max(rg.g.mul(sHi - sLo).add(sLo), 0.02);
        const e = smoothstep(this.uD0, this.uD1, delta).mul(smoothstep(1.0, 3.0, delta.div(sig)));
        If(e.greaterThan(0.001), () => {
          const lab = texture3D(bT, q).level(float(0)).r.mul(255.0);
          const pc = texture(palTex, vec2(lab.add(0.5).div(16.0), 0.5)).level(float(0)).rgb;
          const ramp = mix(vec3(0.16, 0.3, 0.75), vec3(1.0, 0.97, 0.92), smoothstep(0.4, 2.6, delta));
          const col = mix(ramp, pc, select(lab.greaterThan(0.5), float(0.45), float(0.0)));
          acc.addAssign(col.mul(e).mul(e));
        });
      });
      // dt in box units → Mpc of path, normalised to 100 Mpc
      const I = acc.mul(dt.mul(boxMpc / 100)).mul(this.uGain).mul(this.uAmount);
      return vec4(I, 1.0);
    })();
    mat.opacityNode = float(1.0);
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.mesh.name = 'cf4-density';
  }
}
