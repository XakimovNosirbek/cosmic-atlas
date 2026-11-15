/**
 * Streamlines of the CF4++ peculiar-velocity field as glowing ribbons, coloured by basin.
 *
 * Each segment of every polyline (streams.bin, SG h⁻¹ Mpc) is one instance of a unit quad,
 * expanded in screen space in the vertex stage (the streak construction of pointMaterial.ts:
 * along = the projected segment, across = it rotated by −90°, so the quad keeps its winding).
 * Width WIDTH_PX device px, a Gaussian profile across, additive into the HDR scene light, no depth
 * test (the lines are a guide drawn over the galaxies). Brightness rises along each line toward
 * its end (0.25 → 1), so the flow's direction reads at a glance and the lines pile up into bright
 * knots at the attractors. Colour = the basin of the line's seed in Dupuy & Courtois 2023 (CF4
 * basins); lines whose seed lies in no basin are grey and dimmer.
 *
 * Positions are in the layer's SG frame group (rotation + map scale); the group is placed at
 * −camera each frame (relative to eye), so modelViewMatrix carries the float64 offset.
 */

import * as THREE from 'three/webgpu';
import { Fn, attribute, exp, float, length, max, modelViewMatrix, positionGeometry, select, uniform, uv, varying, vec2, vec4, cameraProjectionMatrix, viewportSize } from 'three/tsl';
import { QUAD, srgbToLinearNode } from '../render/pointMaterial';
import { BASIN_COLORS, hexToRgb, type Streams } from './data';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

export const WIDTH_PX = 2.6;

/** per-vertex brightness along a line of k vertices (0 = seed, k−1 = end) */
export function alongGain(j: number, k: number): number {
  return 0.25 + 0.75 * (k > 1 ? j / (k - 1) : 1);
}

export class StreamLines {
  readonly mesh: THREE.Mesh;
  readonly uAmount = uniform(0);
  readonly uGain = uniform(0.035);
  readonly uDpr = uniform(1);
  readonly segments: number;

  constructor(s: Streams) {
    let nseg = 0;
    for (let i = 0; i < s.count.length; i++) nseg += Math.max(0, s.count[i] - 1);
    this.segments = nseg;
    const A = new Float32Array(nseg * 3);
    const B = new Float32Array(nseg * 3);
    const col = new Float32Array(nseg * 3);
    const gain = new Float32Array(nseg * 2);
    let k = 0;
    for (let i = 0; i < s.count.length; i++) {
      const f = s.first[i];
      const c = s.count[i];
      const lab = s.seedBasin[i];
      const rgb = hexToRgb(BASIN_COLORS[lab] ?? BASIN_COLORS[0]);
      const dim = lab === 0 ? 0.35 : 1;
      for (let j = 0; j < c - 1; j++) {
        A.set(s.pos.subarray((f + j) * 3, (f + j) * 3 + 3), k * 3);
        B.set(s.pos.subarray((f + j + 1) * 3, (f + j + 1) * 3 + 3), k * 3);
        col.set(rgb, k * 3);
        gain[k * 2] = alongGain(j, c) * dim;
        gain[k * 2 + 1] = alongGain(j + 1, c) * dim;
        k++;
      }
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setIndex(QUAD.index!.clone());
    g.setAttribute('position', QUAD.getAttribute('position').clone());
    g.setAttribute('uv', QUAD.getAttribute('uv').clone());
    g.setAttribute('segA', new THREE.InstancedBufferAttribute(A, 3));
    g.setAttribute('segB', new THREE.InstancedBufferAttribute(B, 3));
    g.setAttribute('segCol', new THREE.InstancedBufferAttribute(col, 3));
    g.setAttribute('segGain', new THREE.InstancedBufferAttribute(gain, 2));
    g.instanceCount = nseg;

    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
    const a = attribute('segA', 'vec3');
    const b = attribute('segB', 'vec3');
    const ca = cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(a, 1.0)));
    const cb = cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(b, 1.0)));
    const halfVp = viewportSize.mul(0.5);
    const inFront = ca.w.greaterThan(0.0).and(cb.w.greaterThan(0.0));
    const na = ca.xy.div(max(ca.w, 1e-30));
    const nb = cb.xy.div(max(cb.w, 1e-30));
    const seg = nb.sub(na).mul(halfVp); // px
    const segLen = length(seg);
    const dir = select(segLen.greaterThan(1e-3), seg.div(segLen), vec2(1.0, 0.0));
    const perp = vec2(dir.y, dir.x.negate());
    const along = positionGeometry.y.add(0.5); // 0 at A, 1 at B
    const w = this.uDpr.mul(WIDTH_PX);
    // the quad runs from A − w/2 to B + w/2 along the segment (round-ish joins), w wide across
    const offPx = seg.mul(along).add(dir.mul(positionGeometry.y.mul(w))).add(perp.mul(positionGeometry.x.mul(w).mul(2.0)));
    const base = select(along.lessThan(0.5), ca, cb);
    const pNdc = na.add(offPx.div(halfVp));
    mat.vertexNode = select(inFront, vec4(pNdc.mul(base.w), base.z, base.w), vec4(2.0, 2.0, 2.0, 1.0));
    const g2 = attribute('segGain', 'vec2');
    const vGain: N = varying(select(along.lessThan(0.5), g2.x, g2.y), 'vSegGain');
    const vCol: N = varying(srgbToLinearNode(attribute('segCol', 'vec3')), 'vSegCol');
    mat.colorNode = Fn(() => {
      const across = uv().x.mul(2.0).sub(1.0);
      const prof = exp(across.mul(across).mul(-4.0));
      return vec4(vCol.mul(prof).mul(vGain).mul(this.uGain).mul(this.uAmount), float(1.0));
    })();
    mat.opacityNode = float(1.0);
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.name = 'cf4-streams';
  }
}
