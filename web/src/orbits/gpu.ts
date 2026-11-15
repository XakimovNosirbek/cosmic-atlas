/**
 * The GPU path of the star epoch: every moving point integrates its own Galactic orbit in the
 * vertex shader, fixed-step leapfrog relative to the Sun (integrate.ts gpuDisplacement() is the
 * JS twin, line for line). The Sun's coarse-step track (positions and accelerations after each
 * step) and the frame matrices are uniforms shared by every layer, set once per epoch change:
 *
 *   δ0 = H p, u = H v;  u += h/2 a_rel(δ0, 0);  repeat: Δ += h K u, u += h a_rel(δ0 + Δ, i);  Δ += h K u
 *   a_rel(δ, i) = a(x⊙_i + δ) − a⊙_i,   displacement D = A p + B Δ   (pc, added to the point's inst)
 *
 * Where it runs (measured on an Apple M4 Pro, see docs/data-contract.md section 3):
 *   WebGPU  a compute pass per octree node writes each point's displacement into a storage buffer
 *           (`orb`) once per epoch change; drawing then only adds it, so a still view at 100 Myr
 *           costs what "now" costs, whatever the step count
 *   WebGL2  (no storage buffers to read at random) the same loop runs in the vertex shader
 *
 * Working relative to the Sun keeps float32 honest: Δ starts at 0 and only holds the motion, and
 * the force is evaluated at x⊙_i + δ (an 8 kpc vector, ~1 mpc rounding, which changes the force
 * by ~1e-7). The potential is MWPotential2014 (potential.ts), the same formulas as accel().
 */

import * as THREE from 'three/webgpu';
import { Fn, If, Loop, exp, float, instanceIndex, int, log, pow, sqrt, storage, uniform, uniformArray, vec3, vec4 } from 'three/tsl';
import { AMP, BULGE_SERIES_N, BULGE_X_SPLIT, KMS_MYR_PC, MW2014, S_M, lnGamma } from './potential';
import { GPU_N_MAX, type GpuTrack } from './integrate';
import { H } from './galactic';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any; // TSL node

const RC = MW2014.bulge.rcPc;
const DA = MW2014.disk.aPc;
const DB = MW2014.disk.bPc;
const HA = MW2014.halo.aPc;
const C_B = 2 * Math.PI * Math.pow(RC, 3 - MW2014.bulge.alpha);
const GAMMA_SM = Math.exp(lnGamma(S_M));

const vecs = () => Array.from({ length: GPU_N_MAX + 1 }, () => new THREE.Vector4());

export interface OrbitUniforms {
  n: { value: number };
  h: { value: number };
  hk: { value: number };
  xs: { array: THREE.Vector4[] };
  as: { array: THREE.Vector4[] };
  H: { value: THREE.Matrix3 };
  A: { value: THREE.Matrix3 };
  B: { value: THREE.Matrix3 };
}

const m3 = (m: readonly number[]) => new THREE.Matrix3().set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]);

/** one set for every moving material (the Sun's track does not depend on the layer) */
export const ORBIT = {
  n: uniform(0, 'int'),
  h: uniform(0),
  hk: uniform(0),
  xs: uniformArray(vecs(), 'vec4'),
  as: uniformArray(vecs(), 'vec4'),
  H: uniform(m3(H)),
  A: uniform(new THREE.Matrix3()),
  B: uniform(new THREE.Matrix3()),
} as unknown as OrbitUniforms;

/** compute path (WebGPU) or vertex-shader path; main.ts sets it once the backend is known */
export const orbitConfig = { compute: false };

/** hand a track (integrate.ts gpuTrack) to the shader; null = epoch 0 */
export function setOrbitTrack(tr: GpuTrack | null) {
  const U = ORBIT;
  if (!tr) {
    U.n.value = 0;
    return;
  }
  U.n.value = tr.n;
  U.h.value = tr.h;
  U.hk.value = tr.h * KMS_MYR_PC;
  for (let i = 0; i <= tr.n; i++) {
    U.xs.array[i].set(tr.xs[i * 3], tr.xs[i * 3 + 1], tr.xs[i * 3 + 2], 0);
    U.as.array[i].set(tr.as[i * 3], tr.as[i * 3 + 1], tr.as[i * 3 + 2], 0);
  }
  U.A.value.copy(m3(tr.A));
  U.B.value.copy(m3(tr.B));
}

/** γ(0.6, x), potential.ts bulgeGamma() */
const bulgeGamma = Fn(([x]: [N]) => {
  const res = float(0).toVar();
  If(x.lessThan(BULGE_X_SPLIT), () => {
    const term = float(1 / S_M).toVar();
    const sum = float(1 / S_M).toVar();
    Loop({ start: int(1), end: int(BULGE_SERIES_N), type: 'int', condition: '<' }, ({ i }: { i: N }) => {
      term.mulAssign(x.div(float(i).add(S_M)));
      sum.addAssign(term);
    });
    res.assign(sum.mul(exp(x.negate())).mul(pow(x, S_M)));
  }).Else(() => {
    const a1 = S_M - 1;
    const ix = float(1).div(x);
    const tail = float(1).add(ix.mul(a1).mul(float(1).add(ix.mul(a1 - 1).mul(float(1).add(ix.mul(a1 - 2).mul(float(1).add(ix.mul(a1 - 3))))))));
    res.assign(float(GAMMA_SM).sub(pow(x, a1).mul(exp(x.negate())).mul(tail)));
  });
  return res;
});

/** −∇Φ at Galactocentric x (pc), km/s per Myr: potential.ts accel() */
export const accelNode = Fn(([x]: [N]) => {
  const R2 = x.x.mul(x.x).add(x.y.mul(x.y));
  const r2 = R2.add(x.z.mul(x.z));
  const r = sqrt(r2);
  const fb = bulgeGamma(r2.div(RC * RC)).mul(AMP.bulge * C_B).div(r2);
  const fh = log(r.div(HA).add(1)).div(r2).sub(float(1).div(r.mul(r.add(HA)))).mul(AMP.halo);
  const fs = fb.add(fh).div(r);
  const zb = sqrt(x.z.mul(x.z).add(DB * DB));
  const s = zb.add(DA);
  const D2 = R2.add(s.mul(s));
  const iD3 = float(AMP.disk).div(D2.mul(sqrt(D2)));
  const k = fs.add(iD3);
  return vec3(x.x.mul(k), x.y.mul(k), x.z.mul(fs.add(iD3.mul(s).div(zb)))).mul(-KMS_MYR_PC);
});

/**
 * Displacement (pc) of a point at heliocentric p (pc) moving at v (km/s relative to the Sun)
 * after the current epoch, in the co-rotating frame (integrate.ts).
 */
export const orbitDisplacement = Fn(([p, v]: [N, N]) => {
  const U = ORBIT as unknown as Record<string, N>;
  const d0 = U.H.mul(p).toVar();
  const u = U.H.mul(v).toVar();
  const D = vec3(0).toVar();
  const arel = (i: N) => accelNode(U.xs.element(i).xyz.add(d0).add(D)).sub(U.as.element(i).xyz);
  u.addAssign(arel(int(0)).mul(U.h.mul(0.5)));
  Loop({ start: int(1), end: U.n, type: 'int', condition: '<' }, ({ i }: { i: N }) => {
    D.addAssign(u.mul(U.hk));
    u.addAssign(arel(i).mul(U.h));
  });
  D.addAssign(u.mul(U.hk));
  return U.A.mul(p).add(U.B.mul(D));
});

export interface OrbitKernel {
  /** the per-point displacement (xyz pc), bound as the `orb` instance attribute */
  attr: THREE.StorageInstancedBufferAttribute;
  kernel: THREE.ComputeNode;
}

/**
 * The compute pass for one octree node: reads its `inst` (xyz relative to the centre) and `vel`
 * (vx, vy, vz, q) attributes as storage buffers and writes `orb`.
 */
export function makeOrbitKernel(inst: THREE.StorageInstancedBufferAttribute, vel: THREE.StorageInstancedBufferAttribute, count: number,
  center: readonly number[], sunVel: N): OrbitKernel {
  const attr = new THREE.StorageInstancedBufferAttribute(new Float32Array(count * 4), 4);
  // three pads 3-component storage attributes to vec4 on the GPU (WGSL has no packed vec3 arrays)
  const instS: N = storage(inst, 'vec4', count).toReadOnly();
  const velS: N = storage(vel, 'vec4', count).toReadOnly();
  const outS: N = storage(attr, 'vec4', count);
  const c = uniform(new THREE.Vector3(center[0], center[1], center[2]));
  const kernel = Fn(() => {
    const i: N = instanceIndex;
    const p = instS.element(i).xyz.add(c);
    const v = velS.element(i).xyz.sub(sunVel);
    outS.element(i).assign(vec4(orbitDisplacement(p, v), 1.0));
  })().compute(count, [64]) as unknown as THREE.ComputeNode;
  return { attr, kernel };
}
