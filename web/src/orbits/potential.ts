/**
 * Axisymmetric Milky Way potential: galpy's MWPotential2014 (Bovy 2015, ApJS 216, 29, table 1),
 * written out in physical units so it can run on the CPU (here) and in a vertex shader (gpu.ts):
 *
 *   bulge  power law with an exponential cut-off, ρ ∝ r^−α exp(−(r/rc)²), α = 1.8, rc = 1.9 kpc
 *   disc   Miyamoto & Nagai (1975), a = 3 kpc, b = 0.28 kpc
 *   halo   NFW (Navarro, Frenk & White 1997), scale radius a = 16 kpc
 *
 * The amplitudes follow galpy's `normalize`: at R = ro = 8 kpc in the plane the three components
 * supply 5 %, 60 % and 35 % of vc² = (220 km/s)². The potential is kept exactly as galpy defines it
 * (ro = 8 kpc, vo = 220 km/s); only the Sun is placed at the contract's R0 = 8275 pc (galactic.ts),
 * where this model gives vc = 219.24 km/s.
 *
 * Units: pc, km/s, Myr. Φ in (km/s)², accelerations in km/s per Myr (−∇Φ · PC_PER_KMS_MYR).
 */

/** 1 km/s for 1 Myr in pc (Julian years); same constant as tiles/format.ts */
export const KMS_MYR_PC = 1.022712165045695;

export const MW2014 = {
  ref: 'MWPotential2014, Bovy 2015, ApJS 216, 29 (galpy)',
  roPc: 8000,
  voKms: 220,
  bulge: { alpha: 1.8, rcPc: 1900, normalize: 0.05 },
  disk: { aPc: 3000, bPc: 280, normalize: 0.6 },
  halo: { aPc: 16000, normalize: 0.35 },
} as const;

const ALPHA = MW2014.bulge.alpha;
const RC = MW2014.bulge.rcPc;
/** the bulge's enclosed mass is γ(S_M, (r/rc)²); its potential also needs γ(S_P, ·) */
export const S_M = 1.5 - ALPHA / 2; // 0.6
const S_P = 1 - ALPHA / 2; // 0.1
const DA = MW2014.disk.aPc;
const DB = MW2014.disk.bPc;
const HA = MW2014.halo.aPc;

// ------------------------------------------------------------------ incomplete gamma

/** ln Γ(s), Lanczos (g = 7, n = 9), |rel err| < 1e-15 for s > 0 */
export function lnGamma(s: number): number {
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (s < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * s)) - lnGamma(1 - s);
  s -= 1;
  let a = c[0];
  const t = s + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (s + i);
  return 0.5 * Math.log(2 * Math.PI) + (s + 0.5) * Math.log(t) - t + Math.log(a);
}

/** lower incomplete gamma γ(s, x) (not regularised), series / continued fraction (Numerical Recipes 6.2) */
export function gammaLower(s: number, x: number): number {
  if (x <= 0) return 0;
  const lg = lnGamma(s);
  if (x < s + 1) {
    let ap = s;
    let del = 1 / s;
    let sum = del;
    for (let n = 0; n < 500; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-16) break;
    }
    return sum * Math.exp(-x + s * Math.log(x));
  }
  // Q(s, x) by Lentz's continued fraction, γ = Γ(s) (1 − Q)
  const tiny = 1e-300;
  let b = x + 1 - s;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - s);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  const q = Math.exp(-x + s * Math.log(x) - lg) * h;
  return Math.exp(lg) * (1 - q);
}

const GAMMA_SM = Math.exp(lnGamma(S_M));
/** below this x = (r/rc)² the bulge mass uses the series, above it Γ(s) minus the asymptotic tail */
export const BULGE_X_SPLIT = 12;
/** series terms (enough for x < BULGE_X_SPLIT to ~1e-12) */
export const BULGE_SERIES_N = 48;

/**
 * γ(0.6, x) with a fixed amount of work, the same recipe as the shader (gpu.ts), so the CPU
 * integrator and the GPU path share one force law. Checked against gammaLower() to < 1e-9 relative.
 *   x < 12: x^s e^−x Σ_{n<48} x^n / (s (s+1) … (s+n))
 *   x ≥ 12: Γ(s) − x^(s−1) e^−x (1 + (s−1)/x + (s−1)(s−2)/x² + (s−1)(s−2)(s−3)/x³ + …/x⁴)
 */
export function bulgeGamma(x: number): number {
  if (x <= 0) return 0;
  if (x < BULGE_X_SPLIT) {
    let term = 1 / S_M;
    let sum = term;
    for (let n = 1; n < BULGE_SERIES_N; n++) {
      term *= x / (S_M + n);
      sum += term;
    }
    return sum * Math.exp(-x) * Math.pow(x, S_M);
  }
  const a1 = S_M - 1;
  const ix = 1 / x;
  const tail = 1 + ix * a1 * (1 + ix * (a1 - 1) * (1 + ix * (a1 - 2) * (1 + ix * (a1 - 3))));
  return GAMMA_SM - Math.pow(x, a1) * Math.exp(-x) * tail;
}

// ------------------------------------------------------------------ unit-amplitude components

const C_B = 2 * Math.PI * Math.pow(RC, 3 - ALPHA);

/** dΦ/dr of each component at unit amplitude (spherical r, or cylindrical R in the plane for the disc) */
function bulgeDr(r: number): number {
  return (C_B * bulgeGamma((r / RC) ** 2)) / (r * r);
}
function haloDr(r: number): number {
  return Math.log(1 + r / HA) / (r * r) - 1 / (r * (HA + r));
}
function diskDR(R: number): number {
  const s = DA + DB; // z = 0
  return R / Math.pow(R * R + s * s, 1.5);
}

const RN = MW2014.roPc;
const VN2 = MW2014.voKms ** 2;
/** amplitudes in pc (km/s)², from galpy's normalize: R dΦ_i/dR (ro, 0) = f_i vo² */
export const AMP = {
  bulge: (MW2014.bulge.normalize * VN2) / (RN * bulgeDr(RN)),
  disk: (MW2014.disk.normalize * VN2) / (RN * diskDR(RN)),
  halo: (MW2014.halo.normalize * VN2) / (RN * haloDr(RN)),
};

/**
 * Acceleration −∇Φ at Galactocentric (x, y, z) pc, in km/s per Myr, written into `out`.
 * The disc axis is z; x and y can be any right- or left-handed pair in the plane.
 */
export function accel(x: number, y: number, z: number, out: number[] | Float64Array): void {
  const R2 = x * x + y * y;
  const r2 = R2 + z * z;
  const r = Math.sqrt(r2);
  // spherical parts: −(dΦ/dr) r̂
  const fb = AMP.bulge * bulgeDr(r);
  const fh = AMP.halo * haloDr(r);
  const fs = (fb + fh) / r;
  // Miyamoto–Nagai
  const zb = Math.sqrt(z * z + DB * DB);
  const s = DA + zb;
  const D2 = R2 + s * s;
  const iD3 = AMP.disk / (D2 * Math.sqrt(D2));
  const k = -KMS_MYR_PC;
  out[0] = k * x * (fs + iD3);
  out[1] = k * y * (fs + iD3);
  out[2] = k * z * (fs + (iD3 * s) / zb);
}

/** potential Φ(R, z) in (km/s)², galpy's zero point (for energy checks) */
export function potential(R: number, z: number): number {
  const r = Math.hypot(R, z);
  const x = (r / RC) ** 2;
  const pb = C_B * (gammaLower(S_P, x) / RC - gammaLower(S_M, x) / r);
  const ph = -Math.log(1 + r / HA) / r;
  const s = DA + Math.sqrt(z * z + DB * DB);
  const pd = -1 / Math.sqrt(R * R + s * s);
  return AMP.bulge * pb + AMP.disk * pd + AMP.halo * ph;
}

/** circular speed in the plane, km/s */
export function vcirc(R: number): number {
  return Math.sqrt(R * (AMP.bulge * bulgeDr(R) + AMP.disk * diskDR(R) + AMP.halo * haloDr(R)));
}
