/**
 * Heliocentric contract frame (docs/data-contract.md §1: +x toward l = 0, b = 0, +y toward l = 90°,
 * +z to the NGP, pc) ↔ Galactocentric Cartesian, the astropy `Galactocentric` convention:
 *
 *   g = H (p − (R0, 0, 0)),  H = rotation about y by θ = asin(z⊙ / R0) (the Sun sits z⊙ above the plane)
 *   v_g = H v + v⊙,          v⊙ = (U⊙, vc(R⊙) + V⊙, W⊙)
 *
 * so the Galactic Centre is the origin, the Sun is at (−R0 cos θ, 0, +z⊙) and the disc rotates
 * toward +y (clockwise seen from the NGP). Unlike astropy's default the centre is put exactly at
 * l = b = 0 (where the viewer draws it), not at Sgr A* (0.06° away).
 *
 *   R0 = 8275 pc         GRAVITY Collaboration 2021, A&A 647, A59
 *   z⊙ = 20.8 pc         Bennett & Bovy 2019, MNRAS 482, 1417 (astropy's default)
 *   (U, V, W)⊙ = (11.1, 12.24, 7.25) km/s   Schönrich, Binney & Dehnen 2010, MNRAS 403, 1829
 *   vc(R⊙) = 219.24 km/s  from the potential itself (potential.ts, MWPotential2014)
 */

import { vcirc } from './potential';

export type V3 = [number, number, number];

export const R0_PC = 8275;
export const ZSUN_PC = 20.8;
export const SUN_UVW: Readonly<V3> = [11.1, 12.24, 7.25];

const SIN_T = ZSUN_PC / R0_PC;
const COS_T = Math.sqrt(1 - SIN_T * SIN_T);
/** H, row-major: helio axes → Galactocentric axes */
export const H: readonly number[] = [COS_T, 0, SIN_T, 0, 1, 0, -SIN_T, 0, COS_T];

/** the Sun's cylindrical radius, pc */
export const RSUN_PC = R0_PC * COS_T;
/** circular speed of the model at the Sun, km/s */
export const VC_SUN = vcirc(RSUN_PC);
/** the Sun's Galactocentric position (pc) and velocity (km/s) today */
export const SUN_X: Readonly<V3> = [-R0_PC * COS_T, 0, R0_PC * SIN_T];
export const SUN_V: Readonly<V3> = [SUN_UVW[0], VC_SUN + SUN_UVW[1], SUN_UVW[2]];

export function mul(m: readonly number[], v: readonly number[]): V3 {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}

export function mulT(m: readonly number[], v: readonly number[]): V3 {
  return [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
}

/** a · b for row-major 3×3 matrices */
export function matMul(a: readonly number[], b: readonly number[]): number[] {
  const o = new Array<number>(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return o;
}

export function transpose(m: readonly number[]): number[] {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

/** heliocentric position (pc) and velocity relative to the Sun (km/s) → Galactocentric */
export function helioToGc(p: readonly number[], v: readonly number[]): { x: V3; v: V3 } {
  const x = mul(H, [p[0] - R0_PC, p[1], p[2]]);
  const u = mul(H, v);
  return { x, v: [u[0] + SUN_V[0], u[1] + SUN_V[1], u[2] + SUN_V[2]] };
}

/** Galactocentric position → heliocentric contract frame (today's axes) */
export function gcToHelio(x: readonly number[]): V3 {
  const p = mulT(H, x);
  return [p[0] + R0_PC, p[1], p[2]];
}
