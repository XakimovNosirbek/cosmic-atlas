/**
 * 3D Distance Measurer (A -> B): lets the user pick any object as Point A and click any second
 * object as Point B to measure true 3D Euclidean separation in Galactic Cartesian space, light
 * travel time, and travel time at Voyager 1's speed (~17 km/s), with a live projected SVG line.
 */

import { fmtFixed, t } from '../i18n';
import type { Vec3 } from '../math/frames';
import { formatDistance, formatLightTime, formatLy } from '../math/units';

/** Voyager 1 heliocentric speed (~17.0 km/s) in pc / yr: 17 km/s * 31557600 s/yr / 3.08567758e13 km/pc */
export const VOYAGER_PC_PER_YR = (17.0 * 31557600) / 3.0856775814913673e13;

export interface MeasurePoint {
  name: string;
  xyz: Vec3;
}

export interface MeasureResult {
  distPc: number;
  distText: string;
  lightText: string;
  voyagerText: string;
}

/** pure distance & travel-time calculation, exported for unit tests */
export function computeMeasure(a: Vec3, b: Vec3): MeasureResult {
  const distPc = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const distText = formatDistance(distPc, 4);
  const lightText = distPc < 0.05 ? formatLightTime(distPc) : formatLy(distPc) || formatLightTime(distPc);
  const yrs = distPc / VOYAGER_PC_PER_YR;
  let voyagerText: string;
  if (yrs < 1 / 365.25) voyagerText = t('measure.hours', { n: fmtFixed(yrs * 8766, 1) });
  else if (yrs < 1) voyagerText = t('measure.days', { n: fmtFixed(yrs * 365.25, 1) });
  else if (yrs < 1e3) voyagerText = t('measure.years', { n: fmtFixed(yrs, yrs < 10 ? 1 : 0) });
  else if (yrs < 1e6) voyagerText = t('measure.kyr', { n: fmtFixed(yrs / 1e3, 1) });
  else if (yrs < 1e9) voyagerText = t('measure.myr', { n: fmtFixed(yrs / 1e6, 2) });
  else voyagerText = t('measure.gyr', { n: fmtFixed(yrs / 1e9, 2) });
  return { distPc, distText, lightText, voyagerText };
}

export class DistanceMeasurer {
  a: MeasurePoint | null = null;
  b: MeasurePoint | null = null;
  readonly card: HTMLElement;
  private readonly svg: SVGSVGElement;
  private readonly line: SVGLineElement;
  private readonly dotA: SVGCircleElement;
  private readonly dotB: SVGCircleElement;
  private readonly labelEl: SVGTextElement;
  onChange: () => void = () => {};

  constructor() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg') as SVGSVGElement;
    svg.setAttribute('class', 'measure-svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.display = 'none';
    const line = document.createElementNS(ns, 'line') as SVGLineElement;
    const dotA = document.createElementNS(ns, 'circle') as SVGCircleElement;
    dotA.setAttribute('r', '5');
    const dotB = document.createElementNS(ns, 'circle') as SVGCircleElement;
    dotB.setAttribute('r', '5');
    const labelEl = document.createElementNS(ns, 'text') as SVGTextElement;
    svg.append(line, dotA, dotB, labelEl);
    this.svg = svg;
    this.line = line;
    this.dotA = dotA;
    this.dotB = dotB;
    this.labelEl = labelEl;

    const card = document.createElement('aside');
    card.id = 'measure-card';
    card.className = 'panel measure-card';
    card.setAttribute('role', 'status');
    card.setAttribute('aria-live', 'polite');
    card.hidden = true;
    card.innerHTML = `
      <div class="mc-head">
        <span class="mc-title"></span>
        <button type="button" class="icon-btn mc-clear" aria-label="">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <p class="mc-pair"></p>
      <p class="mc-val"></p>
      <p class="fine mc-sub"></p>`;
    card.querySelector('.mc-clear')!.addEventListener('click', () => this.clear());
    this.card = card;
    document.body.append(svg, card);
  }

  get active(): boolean {
    return this.a !== null;
  }

  get waitingForB(): boolean {
    return this.a !== null && this.b === null;
  }

  startFrom(p: MeasurePoint) {
    this.a = { name: p.name, xyz: [...p.xyz] as Vec3 };
    this.b = null;
    this.renderCard();
    this.onChange();
  }

  /** if waiting for B, complete the measurement with p and return true */
  completeWith(p: MeasurePoint): boolean {
    if (!this.a || this.b) return false;
    if (p.name === this.a.name && p.xyz.every((v, i) => v === this.a!.xyz[i])) return false;
    this.b = { name: p.name, xyz: [...p.xyz] as Vec3 };
    this.renderCard();
    this.onChange();
    return true;
  }

  clear() {
    if (!this.a && !this.b) return;
    this.a = null;
    this.b = null;
    this.card.hidden = true;
    this.svg.style.display = 'none';
    this.onChange();
  }

  relabel() {
    if (this.a) this.renderCard();
  }

  private renderCard() {
    const clearBtn = this.card.querySelector<HTMLButtonElement>('.mc-clear')!;
    clearBtn.setAttribute('aria-label', t('measure.clear'));
    clearBtn.title = t('measure.clear');
    this.card.querySelector('.mc-title')!.textContent = t('measure.title');
    if (!this.a) {
      this.card.hidden = true;
      return;
    }
    this.card.hidden = false;
    if (!this.b) {
      this.card.querySelector('.mc-pair')!.textContent = t('measure.pickSecond', { a: this.a.name });
      this.card.querySelector('.mc-val')!.textContent = '';
      this.card.querySelector('.mc-sub')!.textContent = '';
      return;
    }
    const r = computeMeasure(this.a.xyz, this.b.xyz);
    this.card.querySelector('.mc-pair')!.textContent = `${this.a.name} → ${this.b.name}`;
    this.card.querySelector('.mc-val')!.textContent = `${r.distText} (${r.lightText})`;
    this.card.querySelector('.mc-sub')!.textContent = t('measure.voyager', { t: r.voyagerText });
  }

  /** project A and B onto screen coordinates each frame */
  updateOverlay(project: (p: Vec3) => { x: number; y: number } | null) {
    if (!this.a || !this.b) {
      if (this.svg.style.display !== 'none') this.svg.style.display = 'none';
      return;
    }
    const pa = project(this.a.xyz);
    const pb = project(this.b.xyz);
    if (!pa || !pb) {
      if (this.svg.style.display !== 'none') this.svg.style.display = 'none';
      return;
    }
    this.svg.style.display = 'block';
    this.line.setAttribute('x1', pa.x.toFixed(1));
    this.line.setAttribute('y1', pa.y.toFixed(1));
    this.line.setAttribute('x2', pb.x.toFixed(1));
    this.line.setAttribute('y2', pb.y.toFixed(1));
    this.dotA.setAttribute('cx', pa.x.toFixed(1));
    this.dotA.setAttribute('cy', pa.y.toFixed(1));
    this.dotB.setAttribute('cx', pb.x.toFixed(1));
    this.dotB.setAttribute('cy', pb.y.toFixed(1));
    const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    if (len > 40) {
      const r = computeMeasure(this.a.xyz, this.b.xyz);
      this.labelEl.setAttribute('x', ((pa.x + pb.x) / 2).toFixed(1));
      this.labelEl.setAttribute('y', ((pa.y + pb.y) / 2 - 8).toFixed(1));
      this.labelEl.textContent = r.distText;
      this.labelEl.style.display = '';
    } else {
      this.labelEl.style.display = 'none';
    }
  }
}
