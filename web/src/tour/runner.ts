/**
 * Plays a Tour: flies beat to beat, runs each beat's animation during its dwell (circling the
 * target, moving in, running the star clock, the event-horizon fade), and drives the caption
 * player (Previous / Pause-Play / Next / Close). The scene it changes (camera, layers, selection,
 * star epoch, slab, black hole options, Solar System clock) is snapshotted at the start and put
 * back when the tour ends or is closed.
 *
 * Everything the runner touches in the app goes through TourHost, so main.ts stays the only place
 * that knows the app's internals.
 *
 * Interaction: dragging or zooming the map pauses the tour where it is (the user's camera wins);
 * Play then replays the current stop. Prefers-reduced-motion turns every sweep into a cut: the
 * camera jumps to each animation's end state and the star clock is set, not run.
 */

import type { BlackHoleFeature } from '../blackhole';
import { MIN_DIST, type NavController, type View } from '../nav/controller';
import type { Vec3 } from '../math/frames';
import type { SelRef } from '../state/hash';
import type { TourPlayer } from './player';
import { beatHoles, readMs, resolveBeat, resolveDist, type Beat, type Tour, type TourContext } from './tours';

/** the photon sphere in r_s: the black hole module keeps the camera outside it */
const FLOOR_X = 1.5;

export interface TourHost {
  nav: NavController;
  context(): TourContext;
  layerVisibility(): Record<string, boolean>;
  layerDefaults(): Record<string, boolean>;
  setLayerVisible(id: string, on: boolean): void;
  /** the layer exists and loaded (beats with `needs` are skipped otherwise) */
  layerAvailable(id: string): boolean;
  epoch(): number;
  setEpoch(myr: number): void;
  /** eased change of the star epoch (saved views); cancelEpoch stops it */
  tweenEpoch(myr: number, ms: number): void;
  cancelEpoch(): void;
  slab(): number;
  setSlab(mpc: number): void;
  getSelection(): unknown;
  setSelection(s: unknown): void;
  restoreSelection(ref: SelRef): void;
  /** mark (and on large screens open the card of) the first catalogue object of `names` that exists */
  select(names: string[]): void;
  closeInfo(): void;
  /** keep the focus on a Solar System body (null = stop following) */
  follow(id: string | null): void;
  /** after landing on a `solar` target: focus on it and follow it, as a click on it would */
  solarArrive(name: string): void;
  clockSnapshot(): unknown;
  clockRestore(s: unknown): void;
  setClock(iso: string): void;
  /** the black hole module, loading it if needed (null if it failed) */
  blackHoles(): Promise<BlackHoleFeature | null>;
  openDoc(slug: string): void;
  /** a phone: fold the layers panel so the caption and the view stay clear */
  foldPanels(): void;
  /** the tour ended or was closed (the URL may follow the view again) */
  ended(): void;
  dirty(): void;
}

interface Snapshot {
  view: View;
  layers: Record<string, boolean>;
  sel: unknown;
  epoch: number;
  slab: number;
  flamm: boolean | null;
  disks: Map<string, boolean>;
  clock: unknown | null;
}

export class TourRunner {
  tour: Tour | null = null;
  index = 0;
  paused = false;
  /** the tour finished and stays on its last stop (stayAtEnd); the player shows it until closed */
  ended = false;
  private tok = 0;
  private raf = 0;
  private snap: Snapshot | null = null;
  /** the user moved the camera during this stop: Play replays it */
  private userMoved = false;
  private readonly fadeEl: HTMLElement;
  private fadeOn = false;

  constructor(private host: TourHost, private player: TourPlayer) {
    player.onPrev = () => this.go(this.index - 1);
    player.onNext = () => this.go(this.index + 1);
    player.onJump = (i) => this.go(i);
    player.onToggle = () => this.toggle();
    player.onClose = () => this.stop(true);
    player.onLearn = (slug) => {
      if (!this.paused && !this.ended) this.toggle();
      host.openDoc(slug);
    };
    this.fadeEl = document.createElement('div');
    this.fadeEl.className = 'tour-fade';
    this.fadeEl.hidden = true;
    this.fadeEl.setAttribute('aria-hidden', 'true');
    document.body.append(this.fadeEl);
  }

  get running(): boolean {
    return this.tour !== null && !this.ended;
  }

  get reduced(): boolean {
    return this.host.nav.reducedMotion;
  }

  async start(tour: Tour) {
    this.stop(false);
    const h = this.host;
    // beats whose layer data is not there are skipped (e.g. the CF4 flows on a lite deployment)
    const beats = tour.beats.filter((b) => (b.needs ?? []).every((id) => h.layerAvailable(id)));
    if (!beats.length) return;
    const t: Tour = { ...tour, beats };
    if (beats.some((b) => beatHoles(b).length)) await h.blackHoles();
    const bh = beats.some((b) => b.bh) ? await h.blackHoles() : null;
    const disks = new Map<string, boolean>();
    for (const b of beats) {
      if (!b.bh || !bh) continue;
      const hole = bh.find(b.bh.hole);
      if (hole && !disks.has(hole.name)) disks.set(hole.name, bh.isDiskOn(hole));
    }
    this.snap = {
      view: { ...h.nav.view, focus: [...h.nav.view.focus] as Vec3 },
      layers: h.layerVisibility(),
      sel: h.getSelection(),
      epoch: h.epoch(),
      slab: h.slab(),
      flamm: bh ? bh.flammOn : null,
      disks,
      clock: beats.some((b) => b.clock) ? h.clockSnapshot() : null,
    };
    this.tour = t;
    this.ended = false;
    this.paused = false;
    if (t.narrative && h.epoch() !== 0) h.setEpoch(0); // catalogue objects and their labels sit at today's positions
    h.foldPanels();
    h.closeInfo();
    void this.play(0);
  }

  /** the language changed: re-caption the stop on screen */
  relabel() {
    if (this.tour) this.render();
  }

  /** jump to stop i (Previous / Next / a progress dot); past the last stop ends the tour */
  go(i: number) {
    const t = this.tour;
    if (!t) return;
    if (i >= t.beats.length) return this.finish();
    if (i < 0) i = 0;
    this.ended = false;
    this.paused = false;
    void this.play(i);
  }

  toggle() {
    if (!this.tour) return;
    if (this.ended) return this.go(this.index);
    if (this.paused && this.userMoved) return this.go(this.index); // the camera moved: fly back to this stop
    this.paused = !this.paused;
    this.render();
  }

  /** the user dragged / zoomed / pressed a fly key: hold the tour, keep the user's camera */
  userInput() {
    if (!this.running) return;
    this.userMoved = true;
    if (!this.paused) {
      this.paused = true;
      this.render();
    }
  }

  /** end the tour: the scene goes back to how it was (and the camera too, with restoreView) */
  stop(restoreView: boolean) {
    if (!this.tour) return;
    this.tok++;
    cancelAnimationFrame(this.raf);
    const h = this.host;
    h.nav.cancelFlight();
    h.cancelEpoch();
    this.fade(false);
    this.player.hide();
    const t = this.tour;
    const wasEnded = this.ended;
    this.tour = null;
    this.ended = false;
    this.paused = false;
    if (!wasEnded) this.restoreScene(t, restoreView);
    this.snap = null;
    h.ended();
  }

  private restoreScene(t: Tour, restoreView: boolean) {
    const s = this.snap;
    const h = this.host;
    if (!s) return;
    if (s.clock) h.clockRestore(s.clock);
    if (s.flamm !== null || s.disks.size) {
      void h.blackHoles().then((bh) => {
        if (!bh) return;
        if (s.flamm !== null) bh.flammOn = s.flamm;
        for (const [name, on] of s.disks) bh.setDisk(name, on);
        h.dirty();
      });
    }
    if (t.keepScene) return; // a story ends in its last saved view
    const now = h.layerVisibility();
    for (const [id, on] of Object.entries(s.layers)) if (now[id] !== on) h.setLayerVisible(id, on);
    h.setSelection(s.sel);
    if (h.epoch() !== s.epoch) h.setEpoch(s.epoch);
    if (h.slab() !== s.slab) h.setSlab(s.slab);
    if (restoreView) void h.nav.flyTo(s.view);
  }

  /** the last stop's time is up */
  private finish() {
    const t = this.tour;
    if (!t) return;
    if (t.stayAtEnd) {
      // keep the camera and the last caption; the scene (layers) goes back unless it is a story
      this.tok++;
      cancelAnimationFrame(this.raf);
      this.restoreScene(t, false);
      this.ended = true;
      this.paused = false;
      this.render();
      this.host.ended();
      return;
    }
    this.stop(true);
  }

  private render(progress?: number) {
    const t = this.tour;
    if (!t) return;
    const b = t.beats[this.index];
    const r = resolveBeat(b, this.host.context());
    this.player.show({
      tour: t.label, title: r.title, text: r.text, index: this.index, count: t.beats.length,
      playing: !this.paused && !this.ended, ended: this.ended, doc: b.doc ?? null,
    });
    if (progress !== undefined) this.player.progress(progress);
  }

  private async play(i: number) {
    const t = this.tour;
    if (!t) return;
    const tok = ++this.tok;
    cancelAnimationFrame(this.raf);
    this.index = i;
    this.userMoved = false;
    const h = this.host;
    const beat = t.beats[i];
    const ctx = h.context();
    const holes = beatHoles(beat);
    const bh = holes.length ? await h.blackHoles() : null;
    if (tok !== this.tok) return;
    if (this.fadeOn && beat.fade !== 'horizon') this.fade(false);

    // --- the scene of this stop
    for (const id of beat.show ?? []) h.setLayerVisible(id, true);
    for (const id of beat.hide ?? []) h.setLayerVisible(id, false);
    if (beat.layers) {
      const want = { ...h.layerDefaults(), ...beat.layers };
      for (const [id, on] of Object.entries(h.layerVisibility())) if (want[id] !== undefined && want[id] !== on) h.setLayerVisible(id, want[id]);
    }
    if (beat.slab !== undefined && beat.slab !== h.slab()) h.setSlab(beat.slab);
    if (beat.epochMyr !== undefined) h.tweenEpoch(beat.epochMyr, 1800);
    if (beat.epochAnim?.from !== undefined) h.setEpoch(beat.epochAnim.from);
    if (beat.clock) h.setClock(beat.clock);
    if (bh && beat.bh) {
      if (beat.bh.disk !== undefined) bh.setDisk(beat.bh.hole, beat.bh.disk);
      if (beat.bh.flamm !== undefined) bh.flammOn = beat.bh.flamm;
      h.dirty();
    }
    if (beat.caption || t.narrative) h.closeInfo();
    this.render(0);

    // --- the flight
    h.follow(null);
    const r = resolveBeat(beat, ctx);
    if (holes.length && bh) {
      // real scale down to the photon sphere: lower the navigation floor for the smallest hole of the stop
      const rs = Math.min(...holes.map((n) => bh.find(n)?.rsPc ?? Infinity));
      if (Number.isFinite(rs)) h.nav.minDist = Math.min(MIN_DIST, rs * FLOOR_X * 0.99);
    }
    const view: Partial<View> = { focus: r.focus, dist: r.dist, pitch: r.pitch, ...(r.yaw !== undefined ? { yaw: r.yaw } : {}) };
    const ok = await h.nav.flyTo(view, { durationScale: t.narrative ? 1.3 : 1.15 });
    if (!ok || tok !== this.tok) return;
    if (beat.follow) h.follow(beat.follow);
    if ('solar' in beat.target) h.solarArrive(beat.target.solar);
    if (beat.sel) h.restoreSelection(beat.sel);
    if (beat.select) h.select(beat.select);

    // --- the dwell, with this stop's animation
    const done = await this.dwell(beat, tok, r.text, ctx);
    if (!done || tok !== this.tok) return;
    if (i + 1 < t.beats.length) void this.play(i + 1);
    else this.finish();
  }

  /** resolves true when the stop's time is up, false when the tour moved on (or stopped) meanwhile */
  private dwell(beat: Beat, tok: number, text: string, ctx: TourContext): Promise<boolean> {
    const t = this.tour!;
    const h = this.host;
    const nav = h.nav;
    const total = t.narrative ? readMs(text, beat.dwellMs) : this.reduced ? Math.max(4000, beat.dwellMs) : beat.dwellMs;
    const yaw0 = nav.view.yaw;
    const d0 = nav.view.dist;
    const d1 = beat.approach ? resolveDist(beat.approach, ctx) ?? d0 : d0;
    const orbit = ((beat.orbitDeg ?? 0) * Math.PI) / 180;
    const ep = beat.epochAnim;
    const e0 = ep ? ep.from ?? h.epoch() : 0;
    const fade = beat.fade === 'horizon';
    // the motion takes most of the stop; with a fade, the first 55 % (then 20 % closing to black)
    const moveEnd = fade ? 0.55 : 0.9;
    const moving = orbit !== 0 || d1 !== d0 || !!ep;
    const apply = (f: number) => {
      const m = Math.min(1, f / moveEnd);
      const e = m * m * (3 - 2 * m);
      if (orbit !== 0 || d1 !== d0) {
        const v: Partial<View> = {};
        if (orbit !== 0) v.yaw = yaw0 + orbit * e;
        if (d1 !== d0) v.dist = Math.exp(Math.log(d0) + (Math.log(d1) - Math.log(d0)) * e);
        nav.setView(v);
      }
      if (ep) h.setEpoch(e0 + (ep.to - e0) * m);
      if (fade) this.fadeTo(smooth((f - moveEnd) / 0.2));
    };
    if (this.reduced && (moving || fade)) apply(1); // a cut to the end state, no sweep
    return new Promise((resolve) => {
      let elapsed = 0;
      let last = performance.now();
      const step = (now: number) => {
        if (tok !== this.tok) return resolve(false);
        const dt = Math.min(100, now - last);
        last = now;
        if (!this.paused) elapsed += dt;
        const f = Math.min(1, elapsed / total);
        if (!this.reduced && !this.userMoved && (moving || fade) && !this.paused) apply(f);
        this.player.progress(f);
        if (f >= 1) return resolve(true);
        this.raf = requestAnimationFrame(step);
      };
      this.raf = requestAnimationFrame(step);
    });
  }

  /** the event-horizon illustration: a black disc that grows from the hole until it fills the view */
  private fadeTo(a: number) {
    const el = this.fadeEl;
    if (a <= 0) {
      if (this.fadeOn) this.fade(false);
      return;
    }
    this.fadeOn = true;
    el.hidden = false;
    el.classList.remove('out');
    const r = 8 + a * 110;
    el.style.background = a >= 1 ? '#000' : `radial-gradient(circle at 50% 50%, #000 ${r.toFixed(1)}%, rgba(0, 0, 0, 0) ${(r + 14).toFixed(1)}%)`;
  }

  /** fade the black out again (next stop, or the tour ends) */
  private fade(on: boolean) {
    if (on) return this.fadeTo(1);
    if (!this.fadeOn) return;
    this.fadeOn = false;
    const el = this.fadeEl;
    el.classList.add('out');
    window.setTimeout(() => {
      if (!this.fadeOn) {
        el.hidden = true;
        el.classList.remove('out');
      }
    }, this.reduced ? 0 : 1300);
  }
}

function smooth(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}
