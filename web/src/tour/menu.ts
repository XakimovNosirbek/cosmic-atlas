/**
 * The tours menu: one top-bar button opens a small list of the tours, each with a one-line
 * description and its approximate length. Closed by default; Esc, a click outside or picking a
 * tour closes it.
 */

import { t } from '../i18n';

export interface MenuItem {
  id: string;
  title: string;
  summary: string;
  minutes: number;
  stops: number;
}

export class ToursMenu {
  readonly el: HTMLElement;
  onPick: (id: string) => void = () => {};
  /** called before the first open, and on every open, to (re)build the list */
  items: () => Promise<MenuItem[]> = async () => [];

  constructor(private button: HTMLButtonElement) {
    const el = document.createElement('div');
    el.id = 'tours-menu';
    el.className = 'panel tours-menu';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-labelledby', 'tours-menu-title');
    el.hidden = true;
    el.innerHTML = '<h2 id="tours-menu-title"></h2><ul class="tm-list"></ul>';
    this.el = el;
    button.setAttribute('aria-controls', el.id);
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', () => (el.hidden ? void this.open() : this.close()));
    document.addEventListener('pointerdown', (e) => {
      if (!el.hidden && !el.contains(e.target as Node) && !button.contains(e.target as Node)) this.close();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.close();
        button.focus();
      }
    });
    document.body.append(el);
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  async open() {
    this.button.setAttribute('aria-expanded', 'true');
    this.el.hidden = false;
    await this.render();
    this.el.querySelector<HTMLButtonElement>('.tm-item')?.focus();
  }

  close() {
    this.el.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
  }

  async render() {
    this.el.querySelector('h2')!.textContent = t('tours.menu');
    const list = this.el.querySelector('.tm-list')!;
    const items = await this.items();
    list.innerHTML = '';
    for (const it of items) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tm-item';
      const title = document.createElement('b');
      title.textContent = it.title;
      const sum = document.createElement('span');
      sum.className = 'tm-sum';
      sum.textContent = it.summary;
      const meta = document.createElement('span');
      meta.className = 'tm-meta';
      meta.textContent = t('tours.length', { min: it.minutes, n: it.stops });
      b.append(title, meta, sum);
      b.addEventListener('click', () => {
        this.close();
        this.onPick(it.id);
      });
      li.append(b);
      list.append(li);
    }
  }
}
