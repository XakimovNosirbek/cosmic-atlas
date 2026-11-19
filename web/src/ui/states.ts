/**
 * "Saved views" dialog (state/states.ts): save the current view under a name, go back to one,
 * copy its link, delete it, play the list as a story or copy a link that plays it.
 */

import { t } from '../i18n';
import { formatEpoch } from '../solar/timebar';
import { parseHash } from '../state/hash';
import { MAX_STATES, cleanName, encodeStory, loadStates, storeStates, type SavedState } from '../state/states';

export interface StatesHost {
  /** the current view as a URL hash (written fresh) */
  currentHash(): string;
  /** go to a saved view */
  go(s: SavedState): void;
  /** play these views in order */
  play(list: SavedState[]): void;
  /** copy text; resolves false when the clipboard refused */
  copy(text: string): Promise<boolean>;
  status(msg: string, kind?: 'warn'): void;
}

export class StatesPanel {
  readonly el: HTMLDialogElement;
  private list: SavedState[] = loadStates();
  private input: HTMLInputElement;
  private ol: HTMLOListElement;

  constructor(private host: StatesHost) {
    const d = document.createElement('dialog');
    d.id = 'states';
    d.className = 'panel help states';
    d.setAttribute('aria-labelledby', 'states-title');
    d.innerHTML = `
      <h2 id="states-title"></h2>
      <p class="fine st-intro"></p>
      <form class="st-save">
        <input type="text" maxlength="80" autocomplete="off" />
        <button type="submit" class="btn st-save-btn"></button>
      </form>
      <ol class="st-list"></ol>
      <p class="fine st-empty"></p>
      <p class="fine st-status" role="status" aria-live="polite"></p>
      <div class="st-actions">
        <button type="button" class="btn st-play"></button>
        <button type="button" class="btn st-story-link"></button>
        <button type="button" class="btn st-close"></button>
      </div>`;
    this.el = d;
    this.input = d.querySelector('input')!;
    this.ol = d.querySelector('.st-list')!;
    d.querySelector('form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      this.save();
    });
    d.querySelector('.st-close')!.addEventListener('click', () => d.close());
    d.querySelector('.st-play')!.addEventListener('click', () => {
      if (!this.list.length) return;
      d.close();
      this.host.play(this.list.slice());
    });
    d.querySelector('.st-story-link')!.addEventListener('click', async () => {
      if (!this.list.length) return;
      const url = `${location.origin}${location.pathname}${location.search}#story=${encodeStory(this.list)}`;
      const ok = await this.host.copy(url);
      this.notice(ok ? t('states.storyCopied') : t('status.copyFailed'), ok ? undefined : 'warn');
    });
    document.body.appendChild(d);
    this.relabel();
  }

  private notice(msg: string, kind?: 'warn') {
    const s = this.el.querySelector<HTMLElement>('.st-status');
    if (s) {
      s.textContent = msg;
      s.dataset.tone = kind ?? 'info';
    }
    this.host.status(msg, kind);
  }

  open() {
    this.list = loadStates();
    this.render();
    const s = this.el.querySelector<HTMLElement>('.st-status');
    if (s) s.textContent = '';
    this.input.value = '';
    this.input.placeholder = t('states.defaultName', { n: this.list.length + 1 });
    this.el.showModal();
    this.input.focus();
  }

  relabel() {
    const d = this.el;
    d.querySelector('#states-title')!.textContent = t('states.title');
    d.querySelector('.st-intro')!.textContent = t('states.intro');
    this.input.setAttribute('aria-label', t('states.name'));
    d.querySelector('.st-save-btn')!.textContent = t('states.save');
    d.querySelector('.st-play')!.textContent = t('states.play');
    d.querySelector('.st-story-link')!.textContent = t('states.storyLink');
    d.querySelector('.st-close')!.textContent = t('states.close');
    d.querySelector('.st-empty')!.textContent = t('states.empty');
    this.render();
  }

  /** save the current view (also the debug hook's entry point) */
  save(name?: string): SavedState | null {
    if (this.list.length >= MAX_STATES) {
      this.notice(t('states.full', { n: MAX_STATES }), 'warn');
      return null;
    }
    const s: SavedState = { name: cleanName(name ?? this.input.value) || t('states.defaultName', { n: this.list.length + 1 }), hash: this.host.currentHash() };
    this.list.push(s);
    if (!storeStates(this.list)) this.notice(t('states.notStored'), 'warn');
    this.input.value = '';
    this.input.placeholder = t('states.defaultName', { n: this.list.length + 1 });
    this.render();
    return s;
  }

  get states(): SavedState[] {
    return this.list.slice();
  }

  remove(i: number) {
    this.list.splice(i, 1);
    storeStates(this.list);
    this.render();
  }

  private render() {
    this.ol.textContent = '';
    this.list.forEach((s, i) => {
      const li = document.createElement('li');
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'st-go';
      go.textContent = s.name;
      const ep = parseHash(s.hash).epochYr;
      go.title = ep ? `${t('time.stars')}: ${formatEpoch(ep / 1e6)}` : t('states.go');
      go.addEventListener('click', () => {
        this.el.close();
        this.host.go(s);
      });
      const meta = document.createElement('span');
      meta.className = 'fine st-meta';
      meta.textContent = ep ? formatEpoch(ep / 1e6) : '';
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'st-icon';
      link.textContent = t('states.copy');
      link.addEventListener('click', async () => {
        const url = `${location.origin}${location.pathname}${location.search}${s.hash}`;
        const ok = await this.host.copy(url);
        this.notice(ok ? t('status.copied') : t('status.copyFailed'), ok ? undefined : 'warn');
      });
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'st-icon';
      del.textContent = t('states.delete');
      del.setAttribute('aria-label', `${t('states.delete')}: ${s.name}`);
      del.addEventListener('click', () => this.remove(i));
      const row = document.createElement('div');
      row.className = 'st-row';
      row.append(go, meta, link, del);
      li.append(row);
      this.ol.appendChild(li);
    });
    (this.el.querySelector('.st-empty') as HTMLElement).hidden = this.list.length > 0;
    for (const sel of ['.st-play', '.st-story-link']) (this.el.querySelector(sel) as HTMLButtonElement).disabled = this.list.length === 0;
  }
}
