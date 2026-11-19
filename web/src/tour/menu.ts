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
  private renderTok = 0;

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
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !el.hidden) {
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
    if (this.isOpen) this.el.querySelector<HTMLButtonElement>('.tm-item')?.focus();
  }

  close() {
    this.el.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
  }

  async render() {
    const tok = ++this.renderTok;
    this.el.querySelector('h2')!.textContent = t('tours.menu');
    const list = this.el.querySelector('.tm-list')!;
    let items: MenuItem[];
    // shown until the list arrives (the tour library is a separate download)
    const loading = document.createElement('li');
    loading.className = 'tm-loading';
    loading.textContent = t('tours.loading');
    list.replaceChildren(loading);
    list.setAttribute('aria-busy', 'true');
    try {
      items = await this.items();
    } catch (err) {
      if (tok !== this.renderTok) return;
      // a page left open across a deploy asks for a code chunk that no longer exists; say so
      // instead of showing an empty list
      console.warn('tours: could not load the tour list', err);
      list.innerHTML = '';
      const li = document.createElement('li');
      li.className = 'tm-error';
      const msg = document.createElement('span');
      msg.textContent = t('tours.loadFailed');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tm-item tm-reload';
      b.textContent = t('tours.reload');
      b.addEventListener('click', () => window.location.reload());
      li.append(msg, b);
      list.append(li);
      list.removeAttribute('aria-busy');
      return;
    }
    if (tok !== this.renderTok) return;
    list.removeAttribute('aria-busy');
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
