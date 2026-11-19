/**
 * 3D Constellation stick figures built from the REAL heliocentric Galactic 3D positions of IAU
 * named stars in `named-stars.json`.
 *
 * Seen from the Sun (or Earth), these lines trace the familiar night-sky constellations; as you
 * fly out into the Milky Way (tens to hundreds of parsecs from the Sun), they visibly stretch
 * and deform in 3D, demonstrating that constellations are line-of-sight alignments rather than
 * physical groups.
 *
 * Also provides `zenithViewForObserver()` for the "Night sky from here" planetarium mode.
 */

import * as THREE from 'three/webgpu';
import type { CatalogEntry } from '../data/manifest';
import { normName } from '../data/resolve';
import type { Vec3 } from '../math/frames';
import { PC_PER_AU } from '../math/units';
import { observerGalacticXyz, observerGeocentricPc, type LatLonView } from '../solar/ephemeris';

export interface ConstellationDef {
  iau: string;
  name: string;
  /** polylines of IAU star names (resolved against named-stars.json) */
  lines: string[][];
}

/** 20 major northern & southern sky constellations (all star names verified in named-stars.json) */
export const CONSTELLATIONS: ConstellationDef[] = [
  {
    iau: 'Ori',
    name: 'Orion',
    lines: [
      ['Betelgeuse', 'Bellatrix', 'Mintaka', 'Alnilam', 'Alnitak', 'Betelgeuse'],
      ['Mintaka', 'Rigel', 'Saiph', 'Alnitak'],
      ['Betelgeuse', 'Meissa', 'Bellatrix'],
    ],
  },
  {
    iau: 'UMa',
    name: 'Ursa Major',
    lines: [
      ['Alkaid', 'Mizar', 'Alioth', 'Megrez', 'Dubhe', 'Merak', 'Phecda', 'Megrez'],
    ],
  },
  {
    iau: 'UMi',
    name: 'Ursa Minor',
    lines: [
      ['Polaris', 'Yildun', 'Pherkad', 'Kochab', 'Yildun'],
    ],
  },
  {
    iau: 'Cas',
    name: 'Cassiopeia',
    lines: [
      ['Caph', 'Schedar', 'Tiansi', 'Ruchbah', 'Segin'],
    ],
  },
  {
    iau: 'Cyg',
    name: 'Cygnus',
    lines: [
      ['Deneb', 'Sadr', 'Albireo'],
      ['Gienah', 'Sadr', 'Fawaris'],
    ],
  },
  {
    iau: 'Lyr',
    name: 'Lyra',
    lines: [
      ['Vega', 'Sheliak', 'Sulafat', 'Vega'],
    ],
  },
  {
    iau: 'Aql',
    name: 'Aquila',
    lines: [
      ['Tarazed', 'Altair', 'Alshain'],
    ],
  },
  {
    iau: 'Sco',
    name: 'Scorpius',
    lines: [
      ['Acrab', 'Dschubba', 'Antares', 'Larawag', 'Sargas', 'Shaula', 'Lesath'],
    ],
  },
  {
    iau: 'Leo',
    name: 'Leo',
    lines: [
      ['Regulus', 'Algieba', 'Adhafera', 'Rasalas'],
      ['Regulus', 'Chertan', 'Denebola', 'Zosma', 'Algieba'],
    ],
  },
  {
    iau: 'Tau',
    name: 'Taurus',
    lines: [
      ['Elnath', 'Aldebaran', 'Ain', 'Prima Hyadum', 'Alcyone'],
    ],
  },
  {
    iau: 'Gem',
    name: 'Gemini',
    lines: [
      ['Castor', 'Pollux', 'Wasat', 'Alhena'],
      ['Castor', 'Mebsuta', 'Tejat', 'Propus'],
    ],
  },
  {
    iau: 'Cru',
    name: 'Crux',
    lines: [
      ['Acrux', 'Gacrux'],
      ['Mimosa', 'Imai'],
    ],
  },
  {
    iau: 'CMa',
    name: 'Canis Major',
    lines: [
      ['Mirzam', 'Sirius', 'Muliphein'],
      ['Sirius', 'Wezen', 'Adhara', 'Aludra'],
    ],
  },
  {
    iau: 'Per',
    name: 'Perseus',
    lines: [
      ['Mirfak', 'Algol', 'Atik', 'Menkib'],
    ],
  },
  {
    iau: 'Peg',
    name: 'Pegasus',
    lines: [
      ['Markab', 'Scheat', 'Alpheratz', 'Algenib', 'Markab'],
      ['Markab', 'Biham', 'Enif'],
    ],
  },
  {
    iau: 'And',
    name: 'Andromeda',
    lines: [
      ['Alpheratz', 'Mirach', 'Almach'],
    ],
  },
  {
    iau: 'Boo',
    name: 'Boötes',
    lines: [
      ['Arcturus', 'Izar', 'Nekkar', 'Seginus', 'Arcturus'],
      ['Arcturus', 'Muphrid'],
    ],
  },
  {
    iau: 'Vir',
    name: 'Virgo',
    lines: [
      ['Spica', 'Porrima', 'Vindemiatrix'],
      ['Porrima', 'Zavijava'],
    ],
  },
  {
    iau: 'Aur',
    name: 'Auriga',
    lines: [
      ['Capella', 'Menkalinan', 'Mahasim', 'Elnath', 'Hassaleh', 'Capella'],
    ],
  },
  {
    iau: 'Cen',
    name: 'Centaurus',
    lines: [
      ['Rigil Kentaurus', 'Hadar', 'Menkent'],
    ],
  },
];

export class ConstellationLayer {
  readonly group = new THREE.Group();
  visible = false;
  segmentCount = 0;
  private lines: THREE.LineSegments | null = null;
  private mat: THREE.LineBasicMaterial | null = null;
  private worldPos: Float64Array | null = null;

  constructor() {
    this.group.name = 'constellations';
    this.group.visible = false;
  }

  /** Build 3D line segments from real Galactic coordinates in the loaded catalogue. */
  build(catalog: CatalogEntry[]): number {
    const byName = new Map<string, Vec3>();
    for (const e of catalog) {
      if (!e.xyz || e.kind !== 'star') continue;
      const k = normName(e.name);
      if (!byName.has(k)) byName.set(k, e.xyz);
      for (const a of e.alt ?? []) {
        const ak = normName(a);
        if (!byName.has(ak)) byName.set(ak, e.xyz);
      }
    }

    const verts: number[] = [];
    for (const c of CONSTELLATIONS) {
      for (const poly of c.lines) {
        for (let i = 0; i < poly.length - 1; i++) {
          const a = byName.get(normName(poly[i]));
          const b = byName.get(normName(poly[i + 1]));
          if (!a || !b) continue;
          verts.push(a[0], a[1], a[2], b[0], b[1], b[2]);
        }
      }
    }
    this.segmentCount = verts.length / 6;
    if (!this.segmentCount) return 0;

    this.worldPos = new Float64Array(verts);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts.length), 3));
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color('#7ca8d6'),
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    if (this.lines) {
      this.group.remove(this.lines);
      this.lines.geometry.dispose();
    }
    this.mat?.dispose();
    this.mat = mat;
    this.lines = new THREE.LineSegments(geom, mat);
    this.lines.frustumCulled = false;
    this.group.add(this.lines);
    return this.segmentCount;
  }

  /** Update camera-relative (RTE) vertex positions & smooth distance fade. */
  update(camPos: Vec3, scaleDistPc: number) {
    if (!this.visible || !this.lines || !this.mat || !this.worldPos) {
      this.group.visible = false;
      return;
    }
    // Fade smoothly out beyond ~600 pc so extragalactic views stay uncluttered
    const camR = Math.hypot(camPos[0], camPos[1], camPos[2]);
    const fade = Math.max(0, Math.min(1, 1 - (Math.max(camR, scaleDistPc) - 350) / 1400));
    if (fade < 0.01) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    this.mat.opacity = 0.38 * fade;

    const attr = this.lines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const src = this.worldPos;
    const cx = camPos[0];
    const cy = camPos[1];
    const cz = camPos[2];
    for (let i = 0; i < src.length; i += 3) {
      arr[i] = src[i] - cx;
      arr[i + 1] = src[i + 1] - cy;
      arr[i + 2] = src[i + 2] - cz;
    }
    attr.needsUpdate = true;
  }
}

/**
 * Compute a NavController View standing just above Earth's surface at `(latDeg, lonDeg)` at `date`,
 * looking straight UP toward the observer's real-time local zenith ("Night sky from here").
 */
export function zenithViewForObserver(latDeg: number, lonDeg: number, date: Date | number = Date.now()): LatLonView {
  const surface = observerGalacticXyz(latDeg, lonDeg, 0, date);
  const upRaw = observerGeocentricPc(latDeg, lonDeg, 0, date);
  const len = Math.hypot(upRaw[0], upRaw[1], upRaw[2]) || 1;
  const up: Vec3 = [upRaw[0] / len, upRaw[1] / len, upRaw[2] / len];
  // Place camera 120 km above the surface (clear of Earth's mesh) and focus 1e-6 pc ahead along +up.
  // Because NavController puts camera = focus + dist * dir(yaw, pitch), setting dir = -up places
  // the camera right at `cam` looking straight toward `+up` (local zenith).
  const altPc = (120 / 149597870.7) * PC_PER_AU;
  const dist = 1e-6;
  const focus: Vec3 = [
    surface[0] + up[0] * (altPc + dist),
    surface[1] + up[1] * (altPc + dist),
    surface[2] + up[2] * (altPc + dist),
  ];
  return {
    focus,
    dist,
    yaw: Math.atan2(-up[1], -up[0]),
    pitch: Math.asin(Math.max(-1, Math.min(1, -up[2]))),
  };
}
