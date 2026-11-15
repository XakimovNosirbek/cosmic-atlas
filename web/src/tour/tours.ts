/**
 * Tours are plain data: beats whose targets are durable references (a catalogue name, the Sun,
 * the Galactic Centre, a point between two targets) resolved when the tour PLAYS, so a tour
 * survives catalogue rebuilds (idea from skymap's Tour type, MIT, re-implemented). The runner
 * (tour/runner.ts) snapshots the scene (camera, layers, selection, epoch, black hole options) and
 * restores it afterwards.
 *
 * Animated beats: after the flight lands, a beat may circle its target (orbitDeg), move in or out
 * (approach), run the star clock (epochAnim) and, for the black hole tour, fade to black at the
 * photon sphere (fade: 'horizon'). Distances can be given in Schwarzschild radii of a named hole.
 */

import { t } from '../i18n';
import type { Vec3 } from '../math/frames';
import type { SelRef } from '../state/hash';

export type TargetRef =
  | { sun: true }
  | { gc: true }
  | { catalog: string[]; fallback: Vec3 }
  | { xyz: Vec3 }
  /** a Solar System body by id ('earth', 'mars', ...), at its position when the beat plays */
  | { body: string; fallback: Vec3 }
  /**
   * any Solar System entry by name (planet, probe, Moon / Mars feature, asteroid, comet): the camera
   * frames it the way the Solar System layer does for that kind, and follows it after landing
   */
  | { solar: string }
  | { between: [TargetRef, TargetRef]; t: number }
  /** the viewer's own spot on Earth (browser geolocation, kept in memory only) */
  | { here: true };

/** a fixed distance (pc) or a multiple of the outer edge of the active galaxy layers */
export type DistRef = number | { galaxyEdge: number };
/** beats may also give a distance in Schwarzschild radii of a catalogued black hole */
export type BeatDist = DistRef | { rs: number; hole: string };

export interface Beat {
  id: string;
  target: TargetRef;
  /** camera distance; 0 with a `solar` target = the Solar System layer's own framing */
  dist: BeatDist;
  pitchDeg: number;
  yawDeg?: number;
  /** i18n key of the caption title */
  title: string;
  /** i18n key of the caption text; the message may use {edgeLookback} and the black hole numbers of `facts` */
  text: string;
  /** minimum time on screen after landing (narrative tours also scale it with the caption length) */
  dwellMs: number;
  /** layer ids that must be visible during this beat (restored afterwards) */
  show?: string[];
  /** layer ids hidden during this beat (restored afterwards) */
  hide?: string[];
  /** skip the beat when one of these layers is not available (not built, failed to load) */
  needs?: string[];
  /** look at the target from its day side: yaw = Sun direction + yawDeg (default 0) */
  sunSide?: boolean;
  /** look from the Sun's side of the target, along our line of sight: yaw AND pitch = direction to the Sun, plus yawDeg / pitchDeg */
  earthSide?: boolean;
  /** keep the focus locked to this Solar System body after arriving (it moves ~30 km/s) */
  follow?: string;
  /** caption as plain text (saved views carry the user's own name), instead of the i18n keys */
  caption?: { title: string; text: string };
  /** saved views: layer visibility that differs from the defaults (every other layer goes back to its default) */
  layers?: Record<string, boolean>;
  /** saved views: star epoch, Myr (eased in during the flight) */
  epochMyr?: number;
  /** saved views: what to select on arrival */
  sel?: SelRef;
  /** saved views: thin-slab half-thickness, Mpc (0 = off) */
  slab?: number;

  // --- animated beats (narrative tours)
  /** circle the target by this many degrees of yaw during the dwell (eased) */
  orbitDeg?: number;
  /** move from the arrival distance to this one during the dwell (log-eased) */
  approach?: BeatDist;
  /** black hole display options for this beat (restored afterwards) */
  bh?: { hole: string; disk?: boolean; flamm?: boolean };
  /** run the star clock (Galactic orbits) from `from` (default: the current epoch) to `to` Myr during the dwell */
  epochAnim?: { from?: number; to: number };
  /** open the info card of this catalogue object on arrival (first name that resolves) */
  select?: string[];
  /** 'horizon': after the approach, the view closes to black (an illustration of crossing the event horizon) */
  fade?: 'horizon';
  /** docs article behind the "Learn more" link */
  doc?: string;
  /** black holes whose computed numbers the caption uses: [catalogue name, placeholder prefix] (see bhVars) */
  facts?: [string, string][];
  /** set the Solar System clock (ISO date) for this beat, e.g. daylight over a surface feature; restored after the tour */
  clock?: string;
}

export interface Tour {
  id: string;
  label: string;
  beats: Beat[];
  /** stay at the last beat instead of flying back to where the tour started */
  stayAtEnd?: boolean;
  /** leave the layers, epoch and selection of the last beat in place (stories of saved views) */
  keepScene?: boolean;
  /** one-line description (i18n key) for the tours menu */
  summary?: string;
  /** narrative tours: dwell grows with the caption length so it can be read */
  narrative?: boolean;
}

export interface TourContext {
  catalog(names: string[]): Vec3 | null;
  galacticCentre: Vec3;
  galaxyEdgePc(): number;
  lookbackText(dPc: number): string;
  /** live position of a Solar System body (null if the Solar System layer is absent) */
  body?(id: string): Vec3 | null;
  /** camera looking straight down at the viewer's location, or null without a location */
  here?(): { focus: Vec3; yaw: number; pitch: number } | null;
  /** Schwarzschild radius (pc) of a catalogued black hole, null when the black hole module has not loaded it */
  holeRsPc?(name: string): number | null;
  /** the Solar System layer's view of an entry (planet, probe, feature, small body), null if unknown */
  solarView?(name: string): { focus: Vec3; dist: number; yaw: number; pitch: number } | null;
  /** caption placeholders for a beat (black hole numbers, see bhVars) */
  vars?(beat: Beat): Record<string, string | number>;
}

export function resolveTarget(t: TargetRef, ctx: TourContext): Vec3 {
  if ('sun' in t) return [0, 0, 0];
  if ('gc' in t) return [...ctx.galacticCentre] as Vec3;
  if ('xyz' in t) return [...t.xyz] as Vec3;
  if ('catalog' in t) return ctx.catalog(t.catalog) ?? ([...t.fallback] as Vec3);
  if ('body' in t) return ctx.body?.(t.body) ?? ([...t.fallback] as Vec3);
  if ('solar' in t) return ctx.solarView?.(t.solar)?.focus ?? [0, 0, 0];
  if ('here' in t) return ctx.here?.()?.focus ?? ctx.body?.('earth') ?? [0, 0, 0];
  const a = resolveTarget(t.between[0], ctx);
  const b = resolveTarget(t.between[1], ctx);
  return [a[0] + (b[0] - a[0]) * t.t, a[1] + (b[1] - a[1]) * t.t, a[2] + (b[2] - a[2]) * t.t];
}

/** a beat distance in pc; null when it is in r_s of a hole the black hole module does not know (yet) */
export function resolveDist(d: BeatDist, ctx: TourContext): number | null {
  if (typeof d === 'number') return d;
  if ('galaxyEdge' in d) return d.galaxyEdge * ctx.galaxyEdgePc();
  const rs = ctx.holeRsPc?.(d.hole);
  return rs ? d.rs * rs : null;
}

/** the holes a beat needs the black hole module for (distances in r_s, display options) */
export function beatHoles(b: Beat): string[] {
  const out = new Set<string>();
  for (const d of [b.dist, b.approach]) if (d && typeof d === 'object' && 'rs' in d) out.add(d.hole);
  if (b.bh) out.add(b.bh.hole);
  for (const [h] of b.facts ?? []) out.add(h);
  return [...out];
}

export function resolveBeat(b: Beat, ctx: TourContext) {
  const focus = resolveTarget(b.target, ctx);
  const sv = 'solar' in b.target ? ctx.solarView?.(b.target.solar) ?? null : null;
  const dist = (b.dist === 0 && sv ? sv.dist : resolveDist(b.dist, ctx)) ?? 1;
  let yaw = b.yawDeg !== undefined ? (b.yawDeg * Math.PI) / 180 : undefined;
  let pitch = (b.pitchDeg * Math.PI) / 180;
  const n = Math.hypot(focus[0], focus[1], focus[2]);
  if (b.sunSide && Math.hypot(focus[0], focus[1]) > 0) yaw = Math.atan2(-focus[1], -focus[0]) + (yaw ?? 0);
  if (b.earthSide && n > 0) {
    // along the line of sight from the Sun (Earth): the camera sits between us and the target
    yaw = Math.atan2(-focus[1], -focus[0]) + (yaw ?? 0);
    pitch = Math.asin(-focus[2] / n) + pitch;
  }
  if (sv) {
    yaw = sv.yaw + (yaw ?? 0);
    pitch = sv.pitch;
  }
  const here = 'here' in b.target ? ctx.here?.() : null;
  if (here) {
    // straight down the local vertical, so the viewer's spot is in the middle of the screen
    yaw = here.yaw;
    pitch = here.pitch;
  }
  const edge = ctx.galaxyEdgePc();
  return {
    focus,
    dist,
    pitch,
    yaw,
    title: b.caption ? b.caption.title : t(b.title),
    text: b.caption ? b.caption.text : t(b.text, { edgeLookback: ctx.lookbackText(edge * 0.9), ...(ctx.vars?.(b) ?? {}) }),
  };
}

/** how long a narrative caption stays up after landing: about 15 characters a second, plus a pause */
export function readMs(text: string, minMs = 0): number {
  return Math.max(minMs, 3500 + text.length * 62);
}

/** rough length of a tour (ms) for the menu: flights plus reading time in the current language */
export function tourDurationMs(tour: Tour, ctx: TourContext, flightMs = 5000): number {
  let ms = 0;
  for (const b of tour.beats) {
    const r = resolveBeat(b, ctx);
    ms += flightMs + (tour.narrative ? readMs(r.text, b.dwellMs) : b.dwellMs);
  }
  return ms;
}

export const SCALE_TOUR: Tour = {
  id: 'scale',
  label: 'tour.scale.label',
  summary: 'tour.scale.summary',
  beats: [
    {
      id: 'sun', doc: 'sun', target: { sun: true }, dist: 1e-3, pitchDeg: 20, dwellMs: 3000, title: 'tour.scale.sun.title',
      text: 'tour.scale.sun.text',
    },
    // Earth -> Mars -> Jupiter, at their real positions when the tour plays (Solar System layer)
    {
      id: 'earth', doc: 'earth', target: { body: 'earth', fallback: [0, 0, 0] }, dist: 2.6e-8, pitchDeg: 25, yawDeg: 40, sunSide: true,
      dwellMs: 3600, title: 'tour.scale.earth.title', show: ['solar'],
      text: 'tour.scale.earth.text',
    },
    {
      id: 'mars', doc: 'mars', target: { body: 'mars', fallback: [0, 0, 0] }, dist: 5.5e-10, pitchDeg: 15, yawDeg: 35, sunSide: true,
      dwellMs: 3400, title: 'tour.scale.mars.title', show: ['solar'],
      text: 'tour.scale.mars.text',
    },
    {
      id: 'jupiter', doc: 'jupiter', target: { body: 'jupiter', fallback: [0, 0, 0] }, dist: 1.3e-7, pitchDeg: 20, yawDeg: 30, sunSide: true,
      dwellMs: 3800, title: 'tour.scale.jupiter.title', show: ['solar'],
      text: 'tour.scale.jupiter.text',
    },
    {
      id: 'proxima', doc: 'proxima-b', target: { catalog: ['Proxima Centauri', 'Proxima Cen', 'alf Cen C'], fallback: [0.9024, -0.9364, -0.0438] },
      dist: 1.6, pitchDeg: 17, dwellMs: 3200, title: 'tour.scale.proxima.title',
      text: 'tour.scale.proxima.text',
    },
    {
      id: 'neighbourhood', doc: 'gaia-mission', target: { sun: true }, dist: 3200, pitchDeg: 26, dwellMs: 3800, title: 'tour.scale.neighbourhood.title',
      text: 'tour.scale.neighbourhood.text',
    },
    {
      id: 'milky-way', doc: 'milky-way', target: { gc: true }, dist: 7e4, pitchDeg: 87.5, dwellMs: 4200, title: 'tour.scale.milky-way.title', show: ['milky-way-model'],
      text: 'tour.scale.milky-way.text',
    },
    {
      id: 'local-group', doc: 'local-group',
      target: { between: [{ gc: true }, { catalog: ['Andromeda (M31)', 'M31', 'Andromeda Galaxy'], fallback: [-368258, 608681, -281281] }], t: 0.4 },
      dist: 2.6e6, pitchDeg: 29, dwellMs: 3600, title: 'tour.scale.local-group.title',
      text: 'tour.scale.local-group.text',
    },
    {
      id: 'cosmic-web', doc: 'cosmic-web', target: { sun: true }, dist: { galaxyEdge: 1.4 }, pitchDeg: 29, dwellMs: 4500, title: 'tour.scale.cosmic-web.title',
      text: 'tour.scale.cosmic-web.text',
    },
  ],
};
