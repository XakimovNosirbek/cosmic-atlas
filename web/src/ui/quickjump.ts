/**
 * Quick-jump destination bar under the top search pill: one-click landmarks spanning 19 orders
 * of magnitude (Earth -> Saturn -> Sgr A* -> Gaia BH3 -> Orion -> Andromeda -> Laniakea ->
 * Cosmic web -> CMB), collapsible and fully localised.
 */

import { t } from '../i18n';

export interface QuickDest {
  id: string;
  labelKey: string;
  action:
    | { type: 'focus'; name: string }
    | { type: 'bh'; name: string }
    | { type: 'layer'; id: string };
}

export const QUICK_DESTS: QuickDest[] = [
  { id: 'earth', labelKey: 'qj.earth', action: { type: 'focus', name: 'Earth' } },
  { id: 'saturn', labelKey: 'qj.saturn', action: { type: 'focus', name: 'Saturn' } },
  { id: 'sgra', labelKey: 'qj.sgra', action: { type: 'bh', name: 'Sgr A*' } },
  { id: 'bh3', labelKey: 'qj.bh3', action: { type: 'bh', name: 'Gaia BH3' } },
  { id: 'orion', labelKey: 'qj.orion', action: { type: 'focus', name: 'Orion Nebula' } },
  { id: 'm31', labelKey: 'qj.m31', action: { type: 'focus', name: 'Andromeda (M31)' } },
  { id: 'laniakea', labelKey: 'qj.laniakea', action: { type: 'focus', name: 'Laniakea' } },
  { id: 'web', labelKey: 'qj.web', action: { type: 'layer', id: 'galaxies-desi' } },
  { id: 'cmb', labelKey: 'qj.cmb', action: { type: 'layer', id: 'cmb' } },
];

export class QuickJumpBar {
  readonly el: HTMLElement;
  private buttons = new Map<string, HTMLButtonElement>();
  onPick: (dest: QuickDest) => void = () => {};

  constructor(host: HTMLElement) {
    const nav = document.createElement('nav');
    nav.id = 'quickjump';
    nav.className = 'quickjump';
    nav.setAttribute('aria-label', t('qj.label'));
    for (const d of QUICK_DESTS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'qj-chip';
      b.dataset.id = d.id;
      b.addEventListener('click', () => this.onPick(d));
      this.buttons.set(d.id, b);
      nav.appendChild(b);
    }
    this.el = nav;
    this.relabel();
    host.appendChild(nav);
  }

  relabel() {
    this.el.setAttribute('aria-label', t('qj.label'));
    for (const d of QUICK_DESTS) {
      const b = this.buttons.get(d.id);
      if (b) b.textContent = t(d.labelKey);
    }
  }
}
