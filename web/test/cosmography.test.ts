import { describe, expect, it } from 'vitest';
import { GAL_TO_SG, galToSg, galToSgLB, sgAxis, sgToGal, sgTopDownYawPitch } from '../src/cosmography/sgframe';
import { NavController } from '../src/nav/controller';
import type { Vec3 } from '../src/math/frames';

// astropy 8.0.2: rows of the Galactic → Supergalactic matrix, from transforming the Galactic unit vectors
// (SkyCoord(CartesianRepresentation(e_i), frame='galactic').transform_to(Supergalactic())), repo .venv
const ASTROPY_M = [
  [-7.3574257480437488e-01, 6.7726129641389432e-01, -1.0591144540819700e-16],
  [-7.4553778365233705e-02, -8.0991471306976578e-02, 9.9392259039977493e-01],
  [6.7314530210920764e-01, 7.3127116581696450e-01, 1.1008126222478197e-01],
];
// SkyCoord(l, b, distance=1 Mpc, frame='galactic').supergalactic: (sgl, sgb) and unit cartesian
const CASES: { name: string; l: number; b: number; sgl: number; sgb: number; xyz: Vec3 }[] = [
  { name: 'M87 direction', l: 283.78, b: 74.49, sgl: 102.88186704803125, sgb: -2.3480670441254343, xyz: [-0.2227544255199191, 0.9740133071472481, -0.04097003064889422] },
  { name: 'Norma (A3627)', l: 325.33, b: -7.26, sgl: 188.1518009645833, sgb: 7.043648822291214, xyz: [-0.9824251420269241, -0.14072611878935648, 0.12262544517294072] },
  { name: 'l=100 b=20', l: 100, b: 20, sgl: 20.361036569999353, sgb: 37.1957026581513, xyz: [0.746804296636675, 0.2771560772824576, 0.6045393712161363] },
  { name: 'Galactic Centre', l: 0, b: 0, sgl: 185.78610785056912, sgb: 42.31028735535909, xyz: [-0.7357425748043749, -0.0745537783652337, 0.6731453021092076] },
];
const DEG = Math.PI / 180;
const gal = (l: number, b: number): Vec3 => [Math.cos(b * DEG) * Math.cos(l * DEG), Math.cos(b * DEG) * Math.sin(l * DEG), Math.sin(b * DEG)];

describe('supergalactic frame (de Vaucouleurs, astropy Supergalactic)', () => {
  it('matrix equals astropy to 1e-15', () => {
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(Math.abs(GAL_TO_SG[i * 3 + j] - ASTROPY_M[i][j])).toBeLessThan(1e-15);
  });
  it('is a proper rotation (orthonormal, det +1)', () => {
    const m = GAL_TO_SG;
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) expect(m[i * 3] * m[j * 3] + m[i * 3 + 1] * m[j * 3 + 1] + m[i * 3 + 2] * m[j * 3 + 2]).toBeCloseTo(i === j ? 1 : 0, 14);
    const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
    expect(det).toBeCloseTo(1, 14);
  });
  for (const c of CASES) {
    it(`${c.name}: SGL/SGB and SGX/SGY/SGZ match astropy`, () => {
      const v = gal(c.l, c.b);
      const s = galToSg(v);
      for (let k = 0; k < 3; k++) expect(Math.abs(s[k] - c.xyz[k])).toBeLessThan(1e-14);
      const lb = galToSgLB(v);
      expect(lb.sgl).toBeCloseTo(c.sgl, 10);
      expect(lb.sgb).toBeCloseTo(c.sgb, 10);
      const back = sgToGal(s);
      for (let k = 0; k < 3; k++) expect(back[k]).toBeCloseTo(v[k], 14);
    });
  }
  it('the pole is at (l, b) = (47.37°, 6.32°) and the NGP lies 6.32° from +SGY', () => {
    const z = sgAxis(2);
    expect(Math.atan2(z[1], z[0]) / DEG).toBeCloseTo(47.37, 12);
    expect(Math.asin(z[2]) / DEG).toBeCloseTo(6.32, 12);
    const ngp = galToSg([0, 0, 1]);
    expect(Math.acos(ngp[1]) / DEG).toBeCloseTo(6.32, 10);
  });
  it('the top-down preset puts the camera on +SGZ', () => {
    const { yaw, pitch } = sgTopDownYawPitch();
    const d = NavController.dir(yaw, pitch);
    const s = galToSg(d);
    expect(s[2]).toBeCloseTo(1, 12);
  });
});
