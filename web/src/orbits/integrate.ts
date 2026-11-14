/**
 * Orbits in the Milky Way potential (potential.ts), leapfrog (kick–drift–kick, symplectic,
 * time-reversible; one force evaluation per step) in Galactocentric Cartesian coordinates.
 *
 * What the viewer shows at epoch t is a star's position RELATIVE TO WHERE THE SUN WILL BE, in a
 * frame that turns with the Sun around the Galactic Centre:
 *
 *   P(t) = Hᵀ · Rz(−Δψ⊙(t)) · (x★(t) − x⊙(t))
 *
 * x★, x⊙ are both integrated in the same potential, Δψ⊙ is the Sun's own change of Galactic azimuth,
 * H the tilt of galactic.ts. At t = 0 this is the contract frame; at any t the Sun is the origin, the
 * Galactic Centre stays in the +x direction and the disc rotation stays along +y, so the
 * neighbourhood does not spin around once per Galactic year (the Sun turns ~157° in 100 Myr).
 * Distances to the Sun do not depend on the rotation.
 *
 * Two paths:
 *   cpu  orbitAt(): float64, step ≤ CPU_H_MYR, for the selected star (info card)
 *   gpu  gpuTrack() + gpuDisplacement(): the shader's recipe (gpu.ts) in JS, 16 … 128 steps of
 *        ≤ 0.78 Myr; it integrates the star relative to the Sun, whose
 *        coarse-step track the CPU hands to the shader as uniforms. Algebraically it is the same
 *        KDK as integrating both bodies separately with that step (test/orbits.test.ts).
 */

import { KMS_MYR_PC, accel, potential } from './potential';
import { H, R0_PC, SUN_V, SUN_X, matMul, mul, mulT, transpose, type V3 } from './galactic';

/** CPU integrator step, Myr */
export const CPU_H_MYR = 0.05;
/** GPU fixed step: |t| / n with n = ceil(|t| / GPU_H_MAX_MYR), GPU_N_MIN ≤ n ≤ GPU_N_MAX (128 steps at 100 Myr) */
export const GPU_N_MAX = 128;
export const GPU_N_MIN = 16;
export const GPU_H_MAX_MYR = 100 / GPU_N_MAX;

const K = KMS_MYR_PC;
const HT = transpose(H);

/** one KDK step in place; `a` holds the acceleration at x on entry and on exit */
function kdk(x: Float64Array, v: Float64Array, a: Float64Array, h: number) {
  const hh = 0.5 * h;
  v[0] += a[0] * hh;
  v[1] += a[1] * hh;
  v[2] += a[2] * hh;
  x[0] += v[0] * h * K;
  x[1] += v[1] * h * K;
  x[2] += v[2] * h * K;
  accel(x[0], x[1], x[2], a);
  v[0] += a[0] * hh;
  v[1] += a[1] * hh;
  v[2] += a[2] * hh;
}

export interface Body {
  x: Float64Array;
  v: Float64Array;
  a: Float64Array;
}

export function body(x: readonly number[], v: readonly number[]): Body {
  const b = { x: Float64Array.from(x), v: Float64Array.from(v), a: new Float64Array(3) };
  accel(b.x[0], b.x[1], b.x[2], b.a);
  return b;
}

export const sunBody = () => body(SUN_X, SUN_V);

/** star from the heliocentric contract frame (p pc, v km/s relative to the Sun) */
export function starBody(p: readonly number[], v: readonly number[]): Body {
  const x = mul(H, [p[0] - R0_PC, p[1], p[2]]);
  const u = mul(H, v);
  return body(x, [u[0] + SUN_V[0], u[1] + SUN_V[1], u[2] + SUN_V[2]]);
}

/** integrate a body by n steps of h (Myr, sign = direction), calling visit after each step */
export function leapfrog(b: Body, h: number, n: number, visit?: (i: number, b: Body) => void) {
  for (let i = 1; i <= n; i++) {
    kdk(b.x, b.v, b.a, h);
    visit?.(i, b);
  }
}

/** signed angle from the xy direction of a to that of b (the azimuth step, small) */
function dAzimuth(ax: number, ay: number, bx: number, by: number): number {
  return Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
}

/** Rz(−Δψ): turns the Sun's azimuth at t back onto today's (row-major) */
export function corotation(dpsi: number): number[] {
  const c = Math.cos(dpsi);
  const s = Math.sin(dpsi);
  return [c, s, 0, -s, c, 0, 0, 0, 1];
}

export function energy(b: Body): number {
  return 0.5 * (b.v[0] ** 2 + b.v[1] ** 2 + b.v[2] ** 2) + potential(Math.hypot(b.x[0], b.x[1]), b.x[2]);
}

export function lz(b: Body): number {
  return b.x[0] * b.v[1] - b.x[1] * b.v[0];
}

function steps(tMyr: number, hMax: number) {
  const n = Math.max(1, Math.ceil(Math.abs(tMyr) / hMax - 1e-9));
  return { n, h: tMyr / n };
}

/**
 * CPU path: heliocentric position (pc) at epoch tMyr of a star at p (pc) moving at v (km/s,
 * relative to the Sun), in the co-rotating frame of the module comment. Float64, step ≤ hMax.
 */
export function orbitAt(p: readonly number[], v: readonly number[], tMyr: number, hMax = CPU_H_MYR): V3 {
  if (tMyr === 0) return [p[0], p[1], p[2]];
  const { n, h } = steps(tMyr, hMax);
  const s = starBody(p, v);
  const sun = sunBody();
  let dpsi = 0;
  for (let i = 1; i <= n; i++) {
    const x0 = sun.x[0];
    const y0 = sun.x[1];
    kdk(s.x, s.v, s.a, h);
    kdk(sun.x, sun.v, sun.a, h);
    dpsi += dAzimuth(x0, y0, sun.x[0], sun.x[1]);
  }
  const d: V3 = [s.x[0] - sun.x[0], s.x[1] - sun.x[1], s.x[2] - sun.x[2]];
  return mulT(H, mul(corotation(dpsi), d));
}

/** the Sun's own orbit: azimuth change (rad, unwrapped; negative toward the future) after tMyr */
export function sunAzimuthChange(tMyr: number, hMax = CPU_H_MYR): number {
  const { n, h } = steps(tMyr, hMax);
  const sun = sunBody();
  let dpsi = 0;
  for (let i = 1; i <= n; i++) {
    const x0 = sun.x[0];
    const y0 = sun.x[1];
    kdk(sun.x, sun.v, sun.a, h);
    dpsi += dAzimuth(x0, y0, sun.x[0], sun.x[1]);
  }
  return dpsi;
}

// ------------------------------------------------------------------ GPU recipe (mirrors gpu.ts)

export interface GpuTrack {
  t: number;
  n: number;
  h: number;
  /** the Sun's position (pc) and acceleration (km/s/Myr) after step i = 0..n, Galactocentric */
  xs: Float64Array;
  as: Float64Array;
  dpsi: number;
  /** A = Hᵀ (Rz − I) H, B = Hᵀ Rz (row-major): D = A p + B Δ */
  A: number[];
  B: number[];
}

/** the Sun's coarse-step track for the shader at epoch tMyr (null at t = 0: nothing moves) */
export function gpuTrack(tMyr: number, nMax = GPU_N_MAX, nMin = GPU_N_MIN, hMax = GPU_H_MAX_MYR): GpuTrack | null {
  if (!tMyr) return null;
  const n = Math.min(nMax, Math.max(nMin, Math.ceil(Math.abs(tMyr) / hMax - 1e-9)));
  const h = tMyr / n;
  const sun = sunBody();
  const xs = new Float64Array((n + 1) * 3);
  const as = new Float64Array((n + 1) * 3);
  xs.set(sun.x, 0);
  as.set(sun.a, 0);
  let dpsi = 0;
  for (let i = 1; i <= n; i++) {
    const x0 = sun.x[0];
    const y0 = sun.x[1];
    kdk(sun.x, sun.v, sun.a, h);
    dpsi += dAzimuth(x0, y0, sun.x[0], sun.x[1]);
    xs.set(sun.x, i * 3);
    as.set(sun.a, i * 3);
  }
  const c1 = -2 * Math.sin(dpsi / 2) ** 2; // cos Δψ − 1 without cancellation
  const s = Math.sin(dpsi);
  const RzI = [c1, s, 0, -s, c1, 0, 0, 0, 0];
  const A = matMul(HT, matMul(RzI, H));
  const B = matMul(HT, corotation(dpsi));
  return { t: tMyr, n, h, xs, as, dpsi, A, B };
}

/**
 * The shader's displacement D = P(t) − p for one point (pc), same operations in float64:
 *   δ0 = H p, u = H v;  u += h/2 · a_rel(δ0, 0);  then n times: Δ += h K u, and (but the last) u += h a_rel(δ0 + Δ, i)
 *   a_rel(δ, i) = a(x⊙_i + δ) − a⊙_i;   D = A p + B Δ
 * (the final half kick only changes the velocity, which is never drawn).
 */
export function gpuDisplacement(p: readonly number[], v: readonly number[], tr: GpuTrack): V3 {
  const d0 = mul(H, p);
  const u = mul(H, v);
  const a = new Float64Array(3);
  const D = [0, 0, 0];
  const arel = (i: number, w: number) => {
    const o = i * 3;
    accel(tr.xs[o] + d0[0] + D[0], tr.xs[o + 1] + d0[1] + D[1], tr.xs[o + 2] + d0[2] + D[2], a);
    u[0] += (a[0] - tr.as[o]) * w;
    u[1] += (a[1] - tr.as[o + 1]) * w;
    u[2] += (a[2] - tr.as[o + 2]) * w;
  };
  arel(0, tr.h / 2);
  const hk = tr.h * K;
  for (let i = 1; i <= tr.n; i++) {
    D[0] += u[0] * hk;
    D[1] += u[1] * hk;
    D[2] += u[2] * hk;
    if (i < tr.n) arel(i, tr.h);
  }
  const ap = mul(tr.A, p);
  const bd = mul(tr.B, D);
  return [ap[0] + bd[0], ap[1] + bd[1], ap[2] + bd[2]];
}

/** GPU-path position at the track's epoch */
export function gpuPosition(p: readonly number[], v: readonly number[], tr: GpuTrack | null): V3 {
  if (!tr) return [p[0], p[1], p[2]];
  const d = gpuDisplacement(p, v, tr);
  return [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
}

/** shear allowance for the drift bound, km/s per pc (2|A| ≈ 30 km/s/kpc for the Oort constant A) */
export const DRIFT_SHEAR = 0.03;

/**
 * How far (pc) a point of an octree node can be from its catalogue position at epoch tMyr, for
 * culling: twice the node's fastest velocity (tidal changes of the relative velocity), plus
 * differential rotation over the node's distance r from the Sun, plus the co-rotation |Δψ⊙| r.
 * Checked against every point of the 100 pc Gaia layer at ±10 … ±100 Myr (test/orbits.test.ts).
 */
export function driftBound(r: number, vmax: number, tMyr: number, dpsi: number): number {
  return (2 * vmax + DRIFT_SHEAR * r) * Math.abs(tMyr) * K + Math.abs(dpsi) * r;
}

// ------------------------------------------------------------------ orbit summary, encounters

export interface OrbitSummary {
  /** Galactocentric cylindrical radius range, pc */
  rMin: number;
  rMax: number;
  /** largest |z| above the plane, pc */
  zMax: number;
  /** azimuthal period 2π T / |Δψ| over the integration, Myr */
  period: number;
  energy: number;
  lz: number;
}

/** integrate tMyr forward (default 1 Gyr, ~4.5 Galactic years) with step h and summarise the orbit */
export function orbitSummary(p: readonly number[], v: readonly number[], tMyr = 1000, h = 0.25): OrbitSummary {
  const b = starBody(p, v);
  const e0 = energy(b);
  const l0 = lz(b);
  let rMin = Math.hypot(b.x[0], b.x[1]);
  let rMax = rMin;
  let zMax = Math.abs(b.x[2]);
  let dpsi = 0;
  const n = Math.ceil(tMyr / h);
  for (let i = 1; i <= n; i++) {
    const x0 = b.x[0];
    const y0 = b.x[1];
    kdk(b.x, b.v, b.a, h);
    dpsi += dAzimuth(x0, y0, b.x[0], b.x[1]);
    const R = Math.hypot(b.x[0], b.x[1]);
    if (R < rMin) rMin = R;
    if (R > rMax) rMax = R;
    const z = Math.abs(b.x[2]);
    if (z > zMax) zMax = z;
  }
  return { rMin, rMax, zMax, period: (2 * Math.PI * n * h) / Math.abs(dpsi), energy: e0, lz: l0 };
}

export interface Encounter {
  tMyr: number;
  dPc: number;
}

/**
 * Closest approach to the Sun along both orbits, searched from now out to twice the straight-line
 * time (capped at ±maxMyr); null when the distance still shrinks at the edge of that window.
 */
export function orbitClosestApproach(p: readonly number[], v: readonly number[], maxMyr = 100): Encounter | null {
  const vv = (v[0] ** 2 + v[1] ** 2 + v[2] ** 2) * K * K;
  if (!(vv > 0)) return null;
  const tLin = -(p[0] * v[0] + p[1] * v[1] + p[2] * v[2]) * K / vv;
  let T = Math.max(-maxMyr, Math.min(maxMyr, 2 * tLin));
  if (Math.abs(T) < 1e-3) T = tLin >= 0 ? 1e-3 : -1e-3;
  const hStep = Math.min(0.025, Math.max(1e-4, Math.abs(T) / 4000));
  const { n, h } = steps(T, hStep);
  const s = starBody(p, v);
  const sun = sunBody();
  let px = s.x[0] - sun.x[0];
  let py = s.x[1] - sun.x[1];
  let pz = s.x[2] - sun.x[2];
  let best: Encounter = { tMyr: 0, dPc: Math.hypot(px, py, pz) };
  for (let i = 1; i <= n; i++) {
    kdk(s.x, s.v, s.a, h);
    kdk(sun.x, sun.v, sun.a, h);
    const qx = s.x[0] - sun.x[0];
    const qy = s.x[1] - sun.x[1];
    const qz = s.x[2] - sun.x[2];
    // closest point of the straight segment between the two steps (the step is ≤ 25 kyr)
    const dx = qx - px;
    const dy = qy - py;
    const dz = qz - pz;
    const dd = dx * dx + dy * dy + dz * dz;
    const f = dd > 0 ? Math.max(0, Math.min(1, -(px * dx + py * dy + pz * dz) / dd)) : 0;
    const d = Math.hypot(px + dx * f, py + dy * f, pz + dz * f);
    if (d < best.dPc) best = { tMyr: (i - 1 + f) * h, dPc: d };
    px = qx;
    py = qy;
    pz = qz;
  }
  if (Math.abs(Math.abs(best.tMyr) - Math.abs(n * h)) < Math.abs(h) * 1.01 && Math.abs(T) >= maxMyr) return null;
  return best;
}
