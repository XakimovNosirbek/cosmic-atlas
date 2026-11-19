/**
 * Saved views ("states", after Oviz's saved view states, docs/prior-work.md §7): a named snapshot
 * of the URL hash (state/hash.ts: camera, layers, star epoch `ty=`, selection), kept in this
 * browser's localStorage, shareable as a plain link, and playable in order as a short story through
 * the tour runner (tour/tours.ts). A whole story can be shared too: `#story=<base64url JSON>`.
 */

import { formatHash, parseHash, type HashState } from './hash';
import type { Beat, Tour } from '../tour/tours';

export interface SavedState {
  name: string;
  /** the view as a URL hash, '#v=…&l=…&ty=…&sel=…' */
  hash: string;
}

const KEY = 'cosmic-atlas.states.v1';
/** at most this many states are kept (and played) */
export const MAX_STATES = 24;
const MAX_NAME = 80;

export function cleanName(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

/** keep only well-formed entries whose hash describes a view */
export function sanitize(list: unknown): SavedState[] {
  if (!Array.isArray(list)) return [];
  const out: SavedState[] = [];
  for (const x of list) {
    const name = typeof x?.name === 'string' ? cleanName(x.name) : '';
    const hash = typeof x?.hash === 'string' ? x.hash : '';
    const h = parseHash(hash);
    if (!name || !(h.view || (h.at && h.look))) continue;
    out.push({ name, hash: formatHash({ ...h, focus: undefined, layer: undefined, story: undefined }) });
    if (out.length >= MAX_STATES) break;
  }
  return out;
}

/** the user's saved states; [] when storage is empty, blocked or corrupt */
export function loadStates(): SavedState[] {
  try {
    return sanitize(JSON.parse(localStorage.getItem(KEY) ?? '[]'));
  } catch {
    return [];
  }
}

/** false when the browser refused (private mode, quota) */
export function storeStates(list: SavedState[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(sanitize(list)));
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ story links

const b64urlEncode = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64urlDecode = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

/** the `story=` value for a list of states: base64url of [[name, hash], …] */
export function encodeStory(list: SavedState[]): string {
  return b64urlEncode(JSON.stringify(sanitize(list).map((s) => [s.name, s.hash])));
}

export function decodeStory(v: string): SavedState[] {
  try {
    const arr = JSON.parse(b64urlDecode(v));
    return Array.isArray(arr) ? sanitize(arr.map((x) => (Array.isArray(x) ? { name: x[0], hash: x[1] } : null))) : [];
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------ playback

/** one tour beat that flies to a state and sets its layers, epoch and selection */
export function stateBeat(s: SavedState, i: number, dwellMs = 3500): Beat {
  const h: HashState = parseHash(s.hash);
  const look = h.at ? h.look : h.view ? { dist: h.view.dist, yawDeg: h.view.yawDeg, pitchDeg: h.view.pitchDeg } : undefined;
  return {
    id: `state-${i}`,
    target: h.at ? { catalog: [h.at], fallback: [0, 0, 0] } : { xyz: h.view!.focus },
    dist: look?.dist ?? 10,
    pitchDeg: look?.pitchDeg ?? 20,
    yawDeg: look?.yawDeg,
    title: '',
    text: '',
    caption: { title: s.name, text: '' },
    dwellMs,
    layers: h.layers ?? {},
    epochMyr: (h.epochYr ?? 0) / 1e6,
    sel: h.sel,
    slab: h.slab ?? 0,
  };
}

export function storyTour(list: SavedState[]): Tour {
  return { id: 'story', label: 'states.play', beats: list.map((s, i) => stateBeat(s, i)), stayAtEnd: true, keepScene: true };
}
