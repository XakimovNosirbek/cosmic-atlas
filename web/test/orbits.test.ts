import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { S_M, accel, bulgeGamma, gammaLower, potential, vcirc } from '../src/orbits/potential';
import { H, SUN_V, SUN_X, VC_SUN, helioToGc, mul, mulT } from '../src/orbits/galactic';
import {
  GPU_N_MAX, body, corotation, driftBound, energy, gpuDisplacement, gpuPosition, gpuTrack, leapfrog, lz, orbitAt,
  orbitClosestApproach, orbitSummary, sunAzimuthChange,
} from '../src/orbits/integrate';
import { parseMeta, parseRenderRecords, parseVelocityRecords, readExtRecord } from '../src/tiles/format';

// galpy 1.12.1 reference (scripts/make_orbit_fixtures.py): MWPotential2014, dop853_c, rtol 1e-12
interface Track { t: number[]; x: number[][]; E: number[]; Lz: number[] }
interface Body { name: string; p: number[]; v: number[]; gc_x: number[]; gc_v: number[]; future: Track; past: Track }
const F = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/orbits/galpy_mw2014.json'), 'utf8')) as {
  potential: { R: number; z: number; vc: number | null; aR: number; az: number; phi: number }[];
  frame: { name: string; astropy_x: number[]; astropy_v: number[] }[];
  bodies: Body[];
  gl710: { tMyr: number; dPc: number; linear: { tMyr: number; dPc: number } };
  sun: { periodMyr: number; rMin: number; rMax: number; zMax: number; vcSun: number };
};
const dist = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const stars = F.bodies.slice(1);

describe('MWPotential2014 (potential.ts) against galpy', () => {
  it('circular speed, forces and potential agree to 1e-12', () => {
    const a = [0, 0, 0];
    for (const q of F.potential) {
      accel(-q.R, 0, q.z, a); // the point at azimuth 180°: aR = −a_x
      expect(Math.abs(-a[0] / q.aR - 1)).toBeLessThan(1e-12);
      expect(Math.abs(a[2] - q.az)).toBeLessThan(1e-12 * Math.abs(q.aR));
      expect(Math.abs(potential(q.R, q.z) / q.phi - 1)).toBeLessThan(1e-12);
      if (q.vc) expect(Math.abs(vcirc(q.R) / q.vc - 1)).toBeLessThan(1e-12);
    }
    expect(VC_SUN).toBeCloseTo(F.sun.vcSun, 9); // 219.24 km/s at the Sun
  });

  it('the shader-friendly γ(0.6, x) matches the continued-fraction reference to 1e-9', () => {
    let worst = 0;
    for (let lx = -4; lx < 3; lx += 0.005) worst = Math.max(worst, Math.abs(bulgeGamma(10 ** lx) / gammaLower(S_M, 10 ** lx) - 1));
    expect(worst).toBeLessThan(1e-9);
  });
});

describe('heliocentric ↔ Galactocentric frame (galactic.ts)', () => {
  it('matches astropy Galactocentric (centre at l = b = 0) to 1e-4 pc and 1e-3 km/s', () => {
    F.frame.forEach((f, i) => {
      const g = helioToGc(stars[i].p, stars[i].v);
      expect(dist(g.x, f.astropy_x)).toBeLessThan(1e-4);
      expect(dist(g.v, f.astropy_v)).toBeLessThan(1e-3);
    });
    expect(mul(H, [-8275, 0, 0])).toEqual(SUN_X.map((x) => expect.closeTo(x, 9)));
  });
});

describe('CPU leapfrog (integrate.ts) against galpy, ±100 Myr', () => {
  const report: string[] = [];
  it('Galactocentric positions of the Sun and 5 Gaia stars agree to < 0.1 pc', () => {
    for (const b of F.bodies) {
      for (const tr of [b.future, b.past]) {
        const s = body(b.gc_x, b.gc_v);
        let worst = 0;
        let k = 1;
        leapfrog(s, Math.sign(tr.t[1]) * 0.05, 2000, (i, bb) => {
          if (i % 100 === 0) worst = Math.max(worst, dist(bb.x, tr.x[k++]));
        });
        expect(k).toBe(tr.t.length);
        expect(worst).toBeLessThan(0.1);
        report.push(`${b.name.slice(0, 26)} ${tr.t[1] > 0 ? '+' : '-'}100 Myr: max |Δx| = ${worst.toExponential(2)} pc`);
      }
    }
    console.log(report.join('\n'));
  });

  it('positions relative to the Sun in the co-rotating frame agree with galpy to < 0.1 pc', () => {
    const sun = F.bodies[0];
    for (const b of stars) {
      for (const key of ['future', 'past'] as const) {
        const tr = b[key];
        const st = sun[key];
        let psi = 0;
        for (let k = 1; k < tr.t.length; k++) {
          const a = st.x[k - 1];
          const c = st.x[k];
          psi += Math.atan2(a[0] * c[1] - a[1] * c[0], a[0] * c[0] + a[1] * c[1]);
          const ref = mulT(H, mul(corotation(psi), [tr.x[k][0] - c[0], tr.x[k][1] - c[1], tr.x[k][2] - c[2]]));
          expect(dist(orbitAt(b.p, b.v, tr.t[k]), ref)).toBeLessThan(0.1);
        }
      }
    }
  });

  it('conserves energy and Lz to < 1e-4 over ±100 Myr (step 0.05 Myr)', () => {
    const lines: string[] = [];
    for (const b of F.bodies) {
      let dE = 0;
      let dL = 0;
      for (const sign of [1, -1]) {
        const s = body(b.gc_x, b.gc_v);
        const e0 = energy(s);
        const l0 = lz(s);
        expect(Math.abs(e0 / b.future.E[0] - 1)).toBeLessThan(1e-12); // same zero point as galpy
        expect(Math.abs(l0 / -b.future.Lz[0] - 1)).toBeLessThan(1e-12); // galpy's Lz counts the rotation as positive
        leapfrog(s, sign * 0.05, 2000, (_i, bb) => {
          dE = Math.max(dE, Math.abs(energy(bb) / e0 - 1));
          dL = Math.max(dL, Math.abs(lz(bb) / l0 - 1));
        });
      }
      expect(dE).toBeLessThan(1e-4);
      expect(dL).toBeLessThan(1e-4);
      lines.push(`${b.name.slice(0, 26)} |ΔE/E| ≤ ${dE.toExponential(1)}, |ΔLz/Lz| ≤ ${dL.toExponential(1)}`);
    }
    console.log(lines.join('\n'));
  });

  it('the Sun: azimuthal period, radial and vertical range match galpy', () => {
    const s = orbitSummary([0, 0, 0], [0, 0, 0], 2000, 0.1);
    console.log(`Sun: period ${s.period.toFixed(2)} Myr (galpy ${F.sun.periodMyr.toFixed(2)}), R ${s.rMin.toFixed(0)}–${s.rMax.toFixed(0)} pc, |z| ≤ ${s.zMax.toFixed(1)} pc; ` +
      `circular period at R⊙ ${(2 * Math.PI * Math.abs(SUN_X[0]) / VC_SUN / 1.022712165045695).toFixed(1)} Myr`);
    expect(Math.abs(s.period - F.sun.periodMyr)).toBeLessThan(0.05);
    expect(Math.abs(s.rMin - F.sun.rMin)).toBeLessThan(1);
    expect(Math.abs(s.rMax - F.sun.rMax)).toBeLessThan(1);
    expect(Math.abs(s.zMax - F.sun.zMax)).toBeLessThan(0.5);
    // MWPotential2014 has vc(R⊙) = 219 km/s, so with V⊙ = 12.24 km/s the Sun's guiding radius sits
    // ~0.5 kpc outside R⊙: its azimuthal period is ~250 Myr, longer than the 220–240 Myr quoted for
    // models with vc ≈ 230–235 km/s. The circular period at R⊙ is in that range.
    expect(s.period).toBeGreaterThan(240);
    expect(s.period).toBeLessThan(260);
    expect((2 * Math.PI * Math.abs(SUN_X[0])) / VC_SUN / 1.022712165045695).toBeGreaterThan(220);
    expect((2 * Math.PI * Math.abs(SUN_X[0])) / VC_SUN / 1.022712165045695).toBeLessThan(240);
    // the azimuth turns clockwise seen from the NGP: negative toward the future
    expect(sunAzimuthChange(100)).toBeLessThan(-2.4);
  });
});

describe('Gliese 710 close encounter along both orbits', () => {
  it('reproduces 0.05 ± 0.01 pc at +1.3 Myr and the galpy minimum', () => {
    const gl = F.bodies.find((b) => b.name === 'Gliese 710')!;
    const ca = orbitClosestApproach(gl.p, gl.v)!;
    console.log(`Gl 710: orbit ${ca.dPc.toFixed(5)} pc at ${ca.tMyr.toFixed(4)} Myr; galpy ${F.gl710.dPc.toFixed(5)} pc at ${F.gl710.tMyr.toFixed(4)}; ` +
      `straight line ${F.gl710.linear.dPc.toFixed(5)} pc at ${F.gl710.linear.tMyr.toFixed(4)}`);
    expect(Math.abs(ca.dPc - 0.05)).toBeLessThan(0.01);
    expect(Math.abs(ca.tMyr - 1.3)).toBeLessThan(0.05);
    expect(Math.abs(ca.dPc - F.gl710.dPc)).toBeLessThan(1e-4);
    expect(Math.abs(ca.tMyr - F.gl710.tMyr)).toBeLessThan(1e-3);
    // the distance at that epoch from the position the viewer draws (CPU path)
    expect(Math.hypot(...orbitAt(gl.p, gl.v, ca.tMyr, 0.001))).toBeCloseTo(ca.dPc, 4);
  });

  it('from the float16 tile stream too (build_tiles.py output)', () => {
    const FIX = resolve(__dirname, 'fixtures/velocity');
    const b = (p: string) => {
      const x = readFileSync(resolve(FIX, p));
      return x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength) as ArrayBuffer;
    };
    const meta = parseMeta(JSON.parse(readFileSync(resolve(FIX, 'meta.json'), 'utf8')));
    const nd = meta.nodes[0];
    const rec = parseRenderRecords(b('n/r.bin'), nd.count);
    const vel = parseVelocityRecords(b('n/r.vel.bin'), nd.count);
    const ext = b('n/r.ext.bin');
    let g = -1;
    for (let i = 0; i < nd.count; i++) if (readExtRecord(ext, i, meta.extBytesPerPoint).id.toString() === '4270814637616488064') g = i;
    const p = [0, 1, 2].map((k) => nd.center[k] + rec.positions[g * 3 + k]);
    const ca = orbitClosestApproach(p, [vel[g * 4], vel[g * 4 + 1], vel[g * 4 + 2]])!;
    expect(Math.abs(ca.dPc - 0.05)).toBeLessThan(0.01);
    expect(Math.abs(ca.tMyr - 1.3)).toBeLessThan(0.05);
  });
});

describe('GPU recipe (gpuDisplacement, the shader\'s twin) against the CPU integrator', () => {
  // seeded neighbourhood stars: positions within 1 kpc, disc and halo-like velocities
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const sample: { p: number[]; v: number[]; halo: boolean }[] = stars.map((s) => ({ p: s.p, v: s.v, halo: Math.hypot(...s.v) > 150 }));
  for (let i = 0; i < 300; i++) {
    const s = i % 10 === 0 ? 150 : 30;
    sample.push({ p: [gauss() * 400, gauss() * 400, gauss() * 150], v: [gauss() * s - 11, gauss() * s - 20, gauss() * s * 0.6 - 7], halo: s > 30 });
  }

  // fixed steps of ≤ 0.78 Myr: disc stars to 1e-3 of the distance travelled; halo-like stars (fast, some
  // plunging to ~1 kpc from the centre, where an orbit turns in a few Myr) to 1e-2
  it('agrees to 1e-3 (disc) / 1e-2 (halo-like) of the distance travelled, 100 yr to ±100 Myr', () => {
    const lines: string[] = [];
    for (const t of [1e-4, 0.01, 0.3, 1, 3, 10, 30, 60, 100, -0.01, -1, -10, -100]) {
      const tr = gpuTrack(t)!;
      expect(tr.n).toBeLessThanOrEqual(GPU_N_MAX);
      const worst = { disc: [0, 0], halo: [0, 0] };
      for (const s of sample) {
        const cpu = orbitAt(s.p, s.v, t);
        const gpu = gpuPosition(s.p, s.v, tr);
        const d = dist(cpu, gpu);
        // how far the star went relative to the Sun: its displacement or |v| |t|, whichever is larger
        const disp = Math.max(dist(cpu, s.p), Math.hypot(...s.v) * Math.abs(t) * 1.022712165045695);
        expect(d).toBeLessThan((s.halo ? 1e-2 : 1e-3) * disp + 1e-3);
        const w = s.halo ? worst.halo : worst.disc;
        w[0] = Math.max(w[0], d);
        w[1] = Math.max(w[1], d / Math.max(disp, 1e-9));
      }
      lines.push(`t = ${t} Myr: ${tr.n} steps, worst |gpu − cpu| disc ${worst.disc[0].toExponential(2)} pc (${worst.disc[1].toExponential(1)} of the distance travelled), ` +
        `halo-like ${worst.halo[0].toExponential(2)} pc (${worst.halo[1].toExponential(1)})`);
    }
    console.log(lines.join('\n'));
  });

  it('is exactly the KDK of both bodies with the same step (relative formulation)', () => {
    const t = 37.5;
    const tr = gpuTrack(t)!;
    for (const s of sample.slice(0, 20)) {
      const g = helioToGc(s.p, s.v);
      const st = body(g.x, g.v);
      const sun = body(SUN_X, SUN_V);
      leapfrog(st, tr.h, tr.n);
      leapfrog(sun, tr.h, tr.n);
      const ref = mulT(H, mul(corotation(tr.dpsi), [st.x[0] - sun.x[0], st.x[1] - sun.x[1], st.x[2] - sun.x[2]]));
      expect(dist(gpuPosition(s.p, s.v, tr), ref)).toBeLessThan(1e-7 * Math.hypot(...ref) + 1e-9);
    }
  });

  it('moves nothing at t = 0 and keeps the Sun at the origin', () => {
    expect(gpuTrack(0)).toBeNull();
    expect(gpuPosition([1, 2, 3], [4, 5, 6], null)).toEqual([1, 2, 3]);
    expect(Math.hypot(...gpuPosition([0, 0, 0], [0, 0, 0], gpuTrack(80)))).toBeLessThan(1e-9);
    expect(Math.hypot(...orbitAt([0, 0, 0], [0, 0, 0], -80))).toBeLessThan(1e-9);
  });
});

// the real Gaia layers when they are built (gitignored data): every point stays inside the culling
// sphere the streamer grows for its node. The 100 pc preview is checked point by point; the full
// 39.6 M-star layer on every `stride`-th point plus the fastest point of each node.
function cullingCheck(dir: string, stride: number, epochs: number[]) {
  const meta = parseMeta(JSON.parse(readFileSync(resolve(dir, 'meta.json'), 'utf8')));
  const nodes = meta.nodes.map((nd) => {
    const rb = readFileSync(resolve(dir, `n/${nd.name}.bin`));
    const vb = readFileSync(resolve(dir, `n/${nd.name}.vel.bin`));
    const rec = parseRenderRecords(rb.buffer.slice(rb.byteOffset, rb.byteOffset + rb.byteLength) as ArrayBuffer, nd.count);
    const vel = parseVelocityRecords(vb.buffer.slice(vb.byteOffset, vb.byteOffset + vb.byteLength) as ArrayBuffer, nd.count);
    const pick: number[] = [];
    let fast = 0;
    for (let i = 0; i < nd.count; i++) {
      if (i % stride === 0) pick.push(i);
      if (Math.hypot(vel[i * 4], vel[i * 4 + 1], vel[i * 4 + 2]) > Math.hypot(vel[fast * 4], vel[fast * 4 + 1], vel[fast * 4 + 2])) fast = i;
    }
    if (nd.count && fast % stride) pick.push(fast);
    return { nd, rec, vel, pick };
  });
  const lines: string[] = [];
  for (const t of epochs) {
    const tr = gpuTrack(t)!;
    let worst = 0;
    let n = 0;
    for (const { nd, rec, vel, pick } of nodes) {
      const r = Math.hypot(...nd.center) + nd.half * Math.sqrt(3);
      const bound = driftBound(r, nd.vmax ?? 0, t, tr.dpsi);
      for (const i of pick) {
        const p = [0, 1, 2].map((k) => nd.center[k] + rec.positions[i * 3 + k]);
        const d = Math.hypot(...gpuDisplacement(p, [vel[i * 4], vel[i * 4 + 1], vel[i * 4 + 2]], tr));
        worst = Math.max(worst, d / bound);
        n++;
      }
    }
    expect(worst).toBeLessThan(1);
    lines.push(`${meta.layer} t = ${t} Myr: ${n} points, largest displacement / bound = ${worst.toFixed(3)}`);
  }
  console.log(lines.join('\n'));
}

const PREVIEW = resolve(__dirname, '../../data/tiles/stars-gaia-preview');
const FULL = resolve(__dirname, '../../data/tiles/stars-gaia');
describe('culling bound on the real Gaia layers', () => {
  it.skipIf(!existsSync(resolve(PREVIEW, 'meta.json')))('100 pc preview: no point moves farther than driftBound() at ±10 … ±100 Myr', () => {
    cullingCheck(PREVIEW, 1, [-100, -30, 10, 100]);
  }, 120_000);
  it.skipIf(!existsSync(resolve(FULL, 'meta.json')))('full 1 kpc layer (39.6 M stars, 1 in 400 + each node\'s fastest): same', () => {
    cullingCheck(FULL, 400, [-100, 10, 100]);
  }, 300_000);
});
