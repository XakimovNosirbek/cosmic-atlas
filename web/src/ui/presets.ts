/**
 * Curated layer presets ("View modes") at the top of the Layers panel: one click switches
 * coherent sets of layers (and optional sky background / slab) so visitors do not have to
 * toggle 20 individual switches to explore Laniakea flows, 3D dust, or multi-messenger skies.
 */

import { t } from '../i18n';

export interface LayerPreset {
  id: string;
  labelKey: string;
  /** explicit visibility overrides on top of defaults (or 'reset' to restore all defaults) */
  reset?: boolean;
  show?: string[];
  hide?: string[];
  /** optional sky background id ('gaia' | 'erosita' | 'planck857') */
  skyBg?: string;
  /** optional slab half-thickness in Mpc (0 = off) */
  slabMpc?: number;
}

export const LAYER_PRESETS: LayerPreset[] = [
  {
    id: 'default',
    labelKey: 'preset.default',
    reset: true,
    skyBg: 'gaia',
    slabMpc: 0,
  },
  {
    id: 'solar',
    labelKey: 'preset.solar',
    show: ['solar', 'small-bodies', 'satellites', 'constellations'],
    hide: ['galaxies-desi', 'galaxies-sdss', 'galaxies-6dfgs', 'galaxies-2dfgrs', 'gw-volumes', 'cf4-flow', 'cf4-density', 'sg-grid', 'groups-2mrs'],
    skyBg: 'gaia',
    slabMpc: 0,
  },
  {
    id: 'milkyway',
    labelKey: 'preset.milkyway',
    show: ['stars-gaia', 'stars-bright', 'star-clusters', 'milky-way-model', 'dust', 'gaia-sky', 'constellations'],
    hide: ['galaxies-desi', 'galaxies-sdss', 'galaxies-6dfgs', 'galaxies-2dfgrs', 'gw-volumes', 'cf4-flow', 'cf4-density', 'sg-grid', 'groups-2mrs'],
    skyBg: 'gaia',
    slabMpc: 0,
  },
  {
    id: 'laniakea',
    labelKey: 'preset.laniakea',
    show: ['galaxies-2mrs', 'cf4-flow', 'sg-grid', 'groups-2mrs', 'local-group', 'local-volume'],
    hide: ['galaxies-desi', 'galaxies-sdss', 'galaxies-6dfgs', 'galaxies-2dfgrs', 'gw-volumes', 'dust', 'frb', 'neutrinos'],
    skyBg: 'gaia',
    slabMpc: 0,
  },
  {
    id: 'messengers',
    labelKey: 'preset.messengers',
    show: ['gw-volumes', 'frb', 'neutrinos', 'cmb', 'gaia-sky'],
    hide: ['cf4-flow', 'cf4-density', 'sg-grid', 'groups-2mrs', 'small-bodies', 'satellites'],
    skyBg: 'erosita',
    slabMpc: 0,
  },
];

export class PresetsBar {
  readonly el: HTMLElement;
  private activeId = 'default';
  private buttons = new Map<string, HTMLButtonElement>();
  onApply: (preset: LayerPreset) => void = () => {};

  constructor(container: HTMLElement) {
    const wrap = document.createElement('div');
    wrap.className = 'presets';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', t('preset.label'));
    for (const p of LAYER_PRESETS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'preset-btn';
      b.dataset.preset = p.id;
      b.setAttribute('aria-pressed', String(p.id === this.activeId));
      b.addEventListener('click', () => {
        this.setActive(p.id);
        this.onApply(p);
      });
      this.buttons.set(p.id, b);
      wrap.appendChild(b);
    }
    this.el = wrap;
    this.relabel();
    container.prepend(wrap);
  }

  setActive(id: string | null) {
    this.activeId = id ?? '';
    for (const [k, b] of this.buttons) b.setAttribute('aria-pressed', String(k === this.activeId));
  }

  relabel() {
    this.el.setAttribute('aria-label', t('preset.label'));
    for (const p of LAYER_PRESETS) {
      const b = this.buttons.get(p.id);
      if (b) b.textContent = t(p.labelKey);
    }
  }
}
