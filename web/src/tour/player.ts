/**
 * The caption card of a tour: the stop's title and text, a dot per stop, Previous / Pause-Play /
 * Next / Close, a progress line for the time left at this stop, and "Learn more" (the stop's
 * article). Keys while it is up: ← → previous / next, Space pause / play, Esc close.
 *
 * DOM only; TourRunner drives it.
 */

import './tour.css';
import { t } from '../i18n';

export interface PlayerState {
  /** i18n key of the tour name */
  tour: string;
  title: string;
  text: string;
  index: number;
  count: number;
  playing: boolean;
  ended: boolean;
  /** docs slug for "Learn more" (none: the button is hidden) */
  doc: string | null;
  /** optional Web Speech voice narration enabled */
  voice?: boolean;
  voiceSupported?: boolean;
}

const ICON = {
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6v12M15 6v12"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z"/></svg>',
  replay: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5zM20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z"/></svg>',
  voiceOn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  voiceOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="m22 9-6 6M16 9l6 6"/></svg>',
};

export class TourPlayer {
  readonly el: HTMLElement;
  onPrev: () => void = () => {};
  onNext: () => void = () => {};
  onJump: (i: number) => void = () => {};
  onToggle: () => void = () => {};
  onClose: () => void = () => {};
  onLearn: (slug: string) => void = () => {};
  onVoice: () => void = () => {};
  private state: PlayerState | null = null;
  private readonly q = <T extends Element = HTMLElement>(s: string) => this.el.querySelector(s) as T;

  constructor() {
    const el = document.createElement('section');
    el.id = 'tour-player';
    el.className = 'panel tour-player';
    el.hidden = true;
    el.innerHTML = `
      <div class="tp-head">
        <p class="tp-tour"></p>
        <button class="icon-btn tp-close" type="button">${ICON.close}</button>
      </div>
      <div class="tp-body" aria-live="polite">
        <h2 class="tp-title"></h2>
        <p class="tp-text"></p>
      </div>
      <div class="tp-progress" aria-hidden="true"><span></span></div>
      <div class="tp-foot">
        <div class="tp-dots" role="group"></div>
        <div class="tp-ctl">
          <button class="btn btn-read tp-learn" type="button">${ICON.book}<span></span></button>
          <button class="icon-btn tp-voice" type="button" hidden>${ICON.voiceOff}</button>
          <button class="icon-btn tp-prev" type="button">${ICON.prev}</button>
          <button class="icon-btn tp-play" type="button"></button>
          <button class="icon-btn tp-next" type="button">${ICON.next}</button>
        </div>
      </div>`;
    this.el = el;
    this.q('.tp-prev').addEventListener('click', () => this.onPrev());
    this.q('.tp-next').addEventListener('click', () => this.onNext());
    this.q('.tp-play').addEventListener('click', () => this.onToggle());
    this.q('.tp-close').addEventListener('click', () => this.onClose());
    this.q('.tp-learn').addEventListener('click', () => this.state?.doc && this.onLearn(this.state.doc));
    this.q('.tp-voice').addEventListener('click', () => this.onVoice());
    // capture phase, before the map's own keys (arrows orbit the camera there)
    window.addEventListener('keydown', this.onKey, true);
    document.body.append(el);
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  show(s: PlayerState) {
    const prev = this.state;
    this.state = s;
    const el = this.el;
    el.hidden = false;
    document.body.classList.add('has-tour');
    this.q('.tp-tour').textContent = `${t(s.tour)} · ${t('tours.stop', { i: s.index + 1, n: s.count })}`;
    if (!prev || prev.title !== s.title || prev.text !== s.text) {
      this.q('.tp-title').textContent = s.title;
      const tx = this.q('.tp-text');
      tx.textContent = s.text;
      tx.hidden = !s.text;
      this.q('.tp-body').scrollTop = 0;
    }
    const dots = this.q('.tp-dots');
    dots.setAttribute('aria-label', t('tours.stops'));
    if (dots.childElementCount !== s.count) {
      dots.innerHTML = '';
      for (let i = 0; i < s.count; i++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'tp-dot';
        b.addEventListener('click', () => this.onJump(i));
        dots.append(b);
      }
    }
    [...dots.children].forEach((b, i) => {
      b.classList.toggle('done', i < s.index);
      b.setAttribute('aria-current', i === s.index ? 'step' : 'false');
      b.setAttribute('aria-label', t('tours.stop', { i: i + 1, n: s.count }));
    });
    const learn = this.q<HTMLButtonElement>('.tp-learn');
    learn.hidden = !s.doc;
    learn.querySelector('span')!.textContent = t('info.learnMore');
    const label = (sel: string, key: string) => {
      const b = this.q(sel);
      b.setAttribute('aria-label', t(key));
      b.setAttribute('title', t(key));
    };
    label('.tp-prev', 'tours.prev');
    label('.tp-next', 'tours.next');
    label('.tp-close', 'tours.close');
    const voice = this.q<HTMLButtonElement>('.tp-voice');
    voice.hidden = !s.voiceSupported;
    if (s.voiceSupported) {
      voice.innerHTML = s.voice ? ICON.voiceOn : ICON.voiceOff;
      voice.setAttribute('aria-pressed', String(!!s.voice));
      label('.tp-voice', s.voice ? 'tours.voiceOff' : 'tours.voiceOn');
    }
    const play = this.q('.tp-play');
    play.innerHTML = s.ended ? ICON.replay : s.playing ? ICON.pause : ICON.play;
    label('.tp-play', s.ended ? 'tours.replay' : s.playing ? 'tours.pause' : 'tours.play');
    play.setAttribute('aria-pressed', String(!s.playing && !s.ended));
    this.q<HTMLButtonElement>('.tp-prev').disabled = s.index === 0;
    this.q<HTMLButtonElement>('.tp-next').disabled = s.ended;
    el.classList.toggle('paused', !s.playing);
    if (s.ended) this.progress(1);
  }

  /** time spent at this stop, 0..1 */
  progress(f: number) {
    const v = Number.isFinite(f) ? Math.min(1, Math.max(0, f)) : 0;
    this.q<HTMLElement>('.tp-progress span').style.transform = `scaleX(${v.toFixed(4)})`;
  }

  /** re-render in the current language */
  relabel(s: PlayerState) {
    this.state = null;
    this.show(s);
  }

  hide() {
    this.el.hidden = true;
    this.state = null;
    document.body.classList.remove('has-tour');
  }

  private onKey = (e: KeyboardEvent) => {
    if (this.el.hidden || e.metaKey || e.ctrlKey || e.altKey) return;
    const tg = e.target as HTMLElement | null;
    if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.tagName === 'SELECT' || tg.isContentEditable)) return;
    if (tg?.closest('#docs, dialog[open], #tours-menu')) return; // the reader and dialogs keep their own keys
    if (document.querySelector('dialog[open]') || document.getElementById('tours-menu')?.hidden === false) return;
    const k = e.key;
    let run: (() => void) | null = null;
    if (k === 'Escape') run = this.onClose;
    else if (this.state?.ended) return; // after the last stop the map's keys work again
    else if (k === 'ArrowLeft') run = this.onPrev;
    else if (k === 'ArrowRight') run = this.onNext;
    else if (k === ' ' && !(tg && (tg.tagName === 'BUTTON' || tg.tagName === 'A'))) run = this.onToggle;
    if (!run) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    run();
  };
}
