/**
 * Supergalactic frame (de Vaucouleurs et al. 1976, RC2; the definition astropy `Supergalactic` uses).
 *
 * The supergalactic north pole SGB = +90° lies at Galactic (l, b) = (47.37°, +6.32°); the zero point
 * SGL = 0, SGB = 0 lies at (l, b) = (137.37°, 0°), in the Galactic plane. Cartesian SGX, SGY, SGZ
 * follow from (SGL, SGB) like x, y, z from (l, b). Both frames share the origin, so this is a pure
 * rotation; the CF4 grids and the 2MRS groups are given on these axes (scripts/build_cosmography.py).
 *
 * The matrix is built from the two defining directions (not copied numbers), and test/cosmography.test.ts
 * checks it against astropy 8.0.2 (`SkyCoord(...).transform_to(Supergalactic())`) to 1e-15.
 */

import { mulMat3, mulMat3T, type Vec3 } from '../math/frames';

const DEG = Math.PI / 180;

/** Galactic (l, b) of the supergalactic north pole and of the SGL = 0 direction, degrees */
export const SG_POLE_LB = { l: 47.37, b: 6.32 } as const;
export const SG_ZERO_LB = { l: 137.37, b: 0 } as const;

const unit = (l: number, b: number): Vec3 => [Math.cos(b * DEG) * Math.cos(l * DEG), Math.cos(b * DEG) * Math.sin(l * DEG), Math.sin(b * DEG)];

function build(): number[] {
  const z = unit(SG_POLE_LB.l, SG_POLE_LB.b);
  const x = unit(SG_ZERO_LB.l, SG_ZERO_LB.b);
  // y = z × x completes the right-handed set (x ⟂ z holds exactly: the zero point lies 90° from the pole)
  const y: Vec3 = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  // rows = SG axes in Galactic coordinates, so sg = M · gal
  return [...x, ...y, ...z];
}

/** Galactic → supergalactic rotation, row-major: [SGX, SGY, SGZ] = GAL_TO_SG · [x, y, z] */
export const GAL_TO_SG: readonly number[] = build();

export function galToSg(v: Vec3): Vec3 {
  return mulMat3(GAL_TO_SG, v);
}

export function sgToGal(v: Vec3): Vec3 {
  return mulMat3T(GAL_TO_SG, v);
}

/** the Galactic unit vector of supergalactic axis i (0 = SGX, 1 = SGY, 2 = SGZ) */
export function sgAxis(i: 0 | 1 | 2): Vec3 {
  return [GAL_TO_SG[i * 3], GAL_TO_SG[i * 3 + 1], GAL_TO_SG[i * 3 + 2]];
}

/** supergalactic longitude / latitude (degrees, SGL in [0, 360)) of a Galactic vector */
export function galToSgLB(v: Vec3): { sgl: number; sgb: number; dist: number } {
  const s = galToSg(v);
  const r = Math.hypot(...s);
  if (r === 0) return { sgl: 0, sgb: 0, dist: 0 };
  let sgl = Math.atan2(s[1], s[0]) / DEG;
  if (sgl < 0) sgl += 360;
  return { sgl, sgb: Math.asin(Math.max(-1, Math.min(1, s[2] / r))) / DEG, dist: r };
}

/**
 * Camera yaw/pitch (NavController convention: the camera sits at focus + dist·(cos p cos y, cos p sin y, sin p))
 * that looks down the −SGZ axis onto the supergalactic plane. The view's up stays the Galactic +z, which
 * lies 6.3° from +SGY, so the picture comes out the way extragalactic maps draw it: SGX to the right,
 * SGY up (Tully et al. 2014, Fig. 1).
 */
export function sgTopDownYawPitch(): { yaw: number; pitch: number } {
  const z = sgAxis(2);
  return { yaw: Math.atan2(z[1], z[0]), pitch: Math.asin(z[2]) };
}
