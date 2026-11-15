import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { blackHolesFrom } from '../src/blackhole/catalog';
import { G0, schwarzschildRadiusM, tidalAccel, timeDilation } from '../src/blackhole/physics';
import { catalogKey, type CatalogEntry } from '../src/data/manifest';
import { DICTS, LANGS, setLang } from '../src/i18n';
import en from '../src/tour/narrative/en.json';
import ru from '../src/tour/narrative/ru.json';
import uz from '../src/tour/narrative/uz.json';
import { bhNumbers, bhVars, fmtCaption, roundSig } from '../src/tour/bhfacts';
import { TOURS } from '../src/tour/library';
import { beatHoles, readMs, resolveBeat, resolveDist, type Beat, type TourContext } from '../src/tour/tours';

const CAT = resolve(__dirname, '../../data/tiles/catalogs');
const catalog: CatalogEntry[] = readdirSync(CAT).filter((f) => f.endsWith('.json')).flatMap((f) => {
  const d = JSON.parse(readFileSync(resolve(CAT, f), 'utf8'));
  return Array.isArray(d) ? (d as CatalogEntry[]) : [];
});
const names = (e: CatalogEntry) => [e.name, ...(e.alt ?? [])];
const find = (list: string[]) => catalog.find((e) => list.some((n) => names(e).includes(n))) ?? null;
const holes = blackHolesFrom(catalog);
const hole = (n: string) => holes.find((h) => h.name === n)!;
const narrative = TOURS.filter((t) => t.narrative);
const allBeats = narrative.flatMap((t) => t.beats.map((b) => ({ tour: t, b })));

describe('narrative tours: data', () => {
  it('has the five tours, 6-10 stops each, and the scale tour last', () => {
    expect(narrative.map((t) => t.id)).toEqual(['black-holes', 'milky-way', 'star-life', 'universe', 'solar-system']);
    for (const t of narrative) {
      expect(t.beats.length, t.id).toBeGreaterThanOrEqual(6);
      expect(t.beats.length, t.id).toBeLessThanOrEqual(10);
    }
    expect(TOURS.at(-1)!.id).toBe('scale');
  });

  it('every catalogue target and selected object resolves in the shipped catalogues', () => {
    for (const { tour, b } of allBeats) {
      const tg = b.target;
      const lists: string[][] = [];
      if ('catalog' in tg) lists.push(tg.catalog);
      if ('between' in tg) for (const x of tg.between) if ('catalog' in x) lists.push(x.catalog);
      if (b.select) lists.push(b.select);
      for (const l of lists) {
        const e = find(l);
        expect(e, `${tour.id}/${b.id}: ${l.join(' | ')}`).not.toBeNull();
        expect(e!.xyz, `${tour.id}/${b.id}: ${e!.name} has a position`).toBeTruthy();
      }
    }
  });

  it('every named star survives the duplicate check of the viewer (catalogKey keeps Greek letters)', () => {
    const stars = JSON.parse(readFileSync(resolve(CAT, 'named-stars.json'), 'utf8')) as CatalogEntry[];
    const seen = new Set<string>();
    const lost: string[] = [];
    for (const e of stars) {
      const keys = names(e).map(catalogKey).filter(Boolean);
      if (keys.some((k) => seen.has(k))) lost.push(e.name);
      else keys.forEach((k) => seen.add(k));
    }
    expect(lost).toEqual([]);
    expect(catalogKey('α Lyr')).not.toBe(catalogKey('β Lyr'));
  });

  it('no two named stars share a name or alias (the viewer keeps only the first: Siwarha hid Betelgeuse)', () => {
    const stars = JSON.parse(readFileSync(resolve(CAT, 'named-stars.json'), 'utf8')) as CatalogEntry[];
    const seen = new Map<string, string>();
    for (const e of stars) for (const n of new Set(names(e).map((x) => x.toLowerCase()))) {
      expect(seen.get(n) ?? e.name, `${n}: ${seen.get(n)} / ${e.name}`).toBe(e.name);
      seen.set(n, e.name);
    }
  });

  it('every Solar System target exists (planet features, probes, the Sun, comets)', () => {
    const feats = JSON.parse(readFileSync(resolve(CAT, 'planet-features.json'), 'utf8')) as CatalogEntry[];
    const craft = JSON.parse(readFileSync(resolve(CAT, 'spacecraft.json'), 'utf8')) as CatalogEntry[];
    const sbNames = resolve(__dirname, '../../data/tiles/small-bodies/names.json');
    for (const { b } of allBeats) {
      if (!('solar' in b.target)) continue;
      const n = b.target.solar;
      if (n === 'Sun') continue; // a Solar System body, always there
      if (n === '1P/Halley') {
        // the small-bodies tiles are not in git; checked when they are built here
        if (existsSync(sbNames)) expect(readFileSync(sbNames, 'utf8')).toContain('Halley');
        continue;
      }
      expect([...feats, ...craft].some((e) => names(e).includes(n)), n).toBe(true);
    }
  });

  it('every hole of a distance in r_s, a display option or a caption number is a catalogued black hole with a mass', () => {
    for (const { b } of allBeats) for (const h of beatHoles(b)) expect(hole(h), h).toBeTruthy();
  });

  it('every "Learn more" article exists in uz, en and ru', () => {
    for (const t of TOURS) for (const b of t.beats) {
      if (!b.doc) continue;
      for (const l of LANGS) expect(existsSync(resolve(__dirname, `../public/docs/${l}/${b.doc}.md`)), `${l}/${b.doc}`).toBe(true);
    }
  });

  it('is serialisable plain data', () => {
    for (const t of TOURS) expect(JSON.parse(JSON.stringify(t))).toEqual(t);
  });
});

describe('narrative tours: captions in three languages', () => {
  const dicts = { uz, en, ru } as Record<string, Record<string, string>>;
  it('uz, en and ru have the same keys, none empty, the same placeholders', () => {
    const k = Object.keys(en).sort();
    expect(Object.keys(uz).sort()).toEqual(k);
    expect(Object.keys(ru).sort()).toEqual(k);
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of k) for (const l of LANGS) {
      expect(dicts[l][key].trim(), `${l} ${key}`).not.toBe('');
      expect(vars(dicts[l][key]), `${l} ${key}`).toEqual(vars((en as Record<string, string>)[key]));
    }
  });

  it('every tour and stop key exists in all three languages (with the main dictionaries)', () => {
    for (const t of TOURS) {
      const keys = [t.label, t.summary!, ...t.beats.flatMap((b) => [b.title, b.text])];
      for (const key of keys) for (const l of LANGS) expect(DICTS[l], `${l} ${key}`).toHaveProperty([key]);
    }
  });

  it('writes Uzbek with oʻ / gʻ (U+02BB) and ʼ (U+02BC), never ASCII or curly apostrophes', () => {
    for (const [k, v] of Object.entries(uz)) {
      expect(v, k).not.toMatch(/[og]['‘’`]/i);
      expect(v, k).not.toMatch(/[a-z]'[a-z]/i);
    }
  });

  it('every placeholder of a caption is filled by the black hole numbers of its stop', () => {
    for (const { b } of allBeats) {
      const have = Object.assign({}, ...(b.facts ?? []).map(([n, p]) => bhVars(p, hole(n).massMsun)));
      const used = [...(en as Record<string, string>)[b.text].matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      for (const u of used) expect(have, `${b.text} {${u}}`).toHaveProperty([u]);
    }
  });
});

/**
 * Every number in an English caption must appear in the stop's docs article (or the extra articles
 * listed here), or be one of the few values listed with where it comes from; uz and ru must carry
 * the same numbers.
 */
const EXTRA_DOCS: Record<string, string[]> = {
  'mw.near': ['milky-way'], 'mw.centre': ['sgr-a-star'], 'mw.m31': ['lookback-time'], 'life.cluster': ['star'],
  'life.pulsar': ['crab-nebula', 'neutron-star'], 'life.wd': ['star'], 'uni.quasars': ['desi-survey', 'lookback-time'],
  'uni.expansion': ['lookback-time'], 'uni.web': ['desi-survey'], 'bh.intro': ['gaia-bh3'], 'life.giant': ['sun'],
};
const feature = (n: string) => (JSON.parse(readFileSync(resolve(CAT, 'planet-features.json'), 'utf8')) as (CatalogEntry & { diam_km: number })[])
  .find((e) => e.name === n)!;
const dustMeta = JSON.parse(readFileSync(resolve(__dirname, '../../data/tiles/dust/meta.json'), 'utf8')) as { dataRadiusPc: number[] };
const beatOf = (key: string) => allBeats.find(({ b }) => b.text === `nt.${key}.text`)!.b;
/** numbers that come from the stop itself or a catalogue, with the check that ties them to it */
const ALLOWED: Record<string, Record<string, () => boolean>> = {
  'bh.time': { 6: () => (beatOf('bh.time').approach as { rs: number }).rs === 6 },
  'bh.tides': { 3: () => (beatOf('bh.tides').approach as { rs: number }).rs === 3, 2: () => true /* the HUD's 2 m body (hud.ts) */ },
  'bh.photon': { '1.5': () => (beatOf('bh.photon').approach as { rs: number }).rs === 1.5 },
  'mw.orbits': { 30: () => beatOf('mw.orbits').epochAnim?.to === 30 },
  'mw.dust': { '1.25': () => roundSig(dustMeta.dataRadiusPc[1] / 1000, 3) === 1.25, 2024: () => true /* Edenhofer et al. 2024, layer title */ },
  'sol.moon': { 85: () => Math.round(feature('Tycho').diam_km) === 85, 24: () => beatOf('sol.moon').clock!.startsWith('2026-11-24'),
    2026: () => beatOf('sol.moon').clock!.startsWith('2026') },
  'sol.mars': { 154: () => Math.round(feature('Gale').diam_km) === 154 },
};
/** names with digits (M87, Gaia BH3, S2, Voyager 1, Cosmicflows-4, PSR J0534+2200) are not numbers */
const unname = (s: string) => s.replace(/\{\w+\}/g, '').replace(/\b(?:Gaia BH|BH|GW|NGC|PSR J|M|S|Voyager |Cosmicflows-|DR)\d+[\w*+]*/g, '').replace(/\b3D\b/g, '');
const nums = (s: string) => [...unname(s).matchAll(/\d+(?:[.,]\d+)*/g)].map((m) => m[0].replace(/,(?=\d{3}\b)/g, ''));
const digits = (s: string) => new Set([...unname(s).matchAll(/\d+(?:[ ., ]\d+)*/g)].map((m) => m[0].replace(/[ ., ]/g, '')));

describe('narrative tours: numbers have sources', () => {
  it('every number of an English caption is in its article, a catalogue entry or the stop itself', () => {
    const doc = (slug: string) => readFileSync(resolve(__dirname, `../public/docs/en/${slug}.md`), 'utf8').replace(/(\d),(\d{3})/g, '$1$2').replace(/(\d),(\d{3})/g, '$1$2');
    for (const { b } of allBeats) {
      const key = b.text.replace(/^nt\.|\.text$/g, '');
      const src = [b.doc!, ...(EXTRA_DOCS[key] ?? [])].map(doc).join('\n');
      for (const n of nums((en as Record<string, string>)[b.text])) {
        const ok = ALLOWED[key]?.[n];
        if (ok) expect(ok(), `${key}: ${n}`).toBe(true);
        else expect(new RegExp(`(^|[^\\d.])${n.replace('.', '\\.')}($|[^\\d])`).test(src), `${key}: "${n}" not in ${b.doc}`).toBe(true);
      }
    }
  });

  it('uz and ru captions carry the same numbers as the English ones', () => {
    for (const key of Object.keys(en)) {
      const want = new Set((nums((en as Record<string, string>)[key])).map((n) => n.replace(/[.,]/g, '')));
      for (const [l, d] of [['uz', uz], ['ru', ru]] as const) {
        const have = digits((d as Record<string, string>)[key]);
        for (const n of want) expect(have.has(n), `${l} ${key}: ${n}`).toBe(true);
      }
    }
  });
});

describe('black hole caption numbers (bhfacts.ts)', () => {
  it('match the HUD physics for Gaia BH3 and Sgr A*', () => {
    const b3 = hole('Gaia BH3');
    expect(b3.massMsun).toBe(32.7);
    const n = bhNumbers(b3.massMsun);
    expect(n.rsKm).toBeCloseTo(96.6, 1); // r_s = 2GM/c^2
    const rs = schwarzschildRadiusM(32.7);
    expect(n.tid['3']).toBeCloseTo(tidalAccel(rs, 3 * rs, 2) / G0, 6);
    expect(roundSig(n.tid['3'], 2)).toBe(73000); // deadly at 3 r_s
    expect(roundSig(n.tid['15'], 2)).toBe(580000);
    expect(n.slow['6']).toBeCloseTo(1 / timeDilation(6), 12);
    expect(n.slow['15']).toBeCloseTo(Math.sqrt(3), 12);
    const sgr = bhNumbers(hole('Sgr A*').massMsun);
    expect(hole('Sgr A*').massMsun).toBe(4.297e6);
    expect(roundSig(sgr.tid['15'], 2)).toBeCloseTo(3.4e-5, 10); // gentle at the photon sphere of a 4.3 million Sun hole
    expect(roundSig(sgr.rsKm / 1e6, 3)).toBe(12.7); // the sgr-a-star article: about 12.7 million km
  });

  it('formats them for captions in each language', () => {
    setLang('en', { persist: false });
    const v = bhVars('sgr', 4.297e6);
    expect(v.sgr_mass).toBe('4.3 million');
    expect(v.sgr_rs).toBe('12.7 million');
    expect(v.sgr_tid15).toBe('3.4×10⁻⁵');
    expect(bhVars('bh3', 32.7).bh3_tid3).toBe('73,000');
    expect(bhVars('m87', 6.5e9).m87_mass).toBe('6.5 billion');
    setLang('ru', { persist: false });
    expect(bhVars('bh3', 32.7).bh3_slow6).toBe('1,10');
    expect(fmtCaption(3.37e-5)).toBe('3,4×10⁻⁵');
    setLang('uz', { persist: false });
  });
});

describe('animated beats', () => {
  const ctx: TourContext = {
    catalog: (l) => find(l)?.xyz ?? null, galacticCentre: [8275, 0, 0], galaxyEdgePc: () => 2e9, lookbackText: () => '',
    holeRsPc: (n) => holes.find((h) => h.name === n)?.rsPc ?? null,
  };
  it('resolves distances in r_s and the Earth-side view along our line of sight', () => {
    const b = beatOf('bh.bh3');
    const h = hole('Gaia BH3');
    const r = resolveBeat(b, ctx);
    expect(r.dist).toBeCloseTo(3000 * h.rsPc, 20);
    expect(resolveDist(b.approach!, ctx)).toBeCloseTo(60 * h.rsPc, 20);
    // camera = focus + dir(yaw, pitch) * dist must sit between the Sun and the hole
    const d = [Math.cos(r.pitch) * Math.cos(r.yaw!), Math.cos(r.pitch) * Math.sin(r.yaw!), Math.sin(r.pitch)];
    const n = Math.hypot(...h.xyz);
    for (let k = 0; k < 3; k++) expect(d[k]).toBeCloseTo(-h.xyz[k] / n, 9);
    expect(resolveDist({ rs: 1, hole: 'nope' }, ctx)).toBeNull();
  });

  it('gives every narrative stop time to read its caption', () => {
    setLang('en', { persist: false });
    for (const { b } of allBeats) {
      const r = resolveBeat(b as Beat, ctx);
      expect(readMs(r.text), b.id).toBeGreaterThanOrEqual(3500 + r.text.length * 60);
    }
    setLang('uz', { persist: false });
  });

  it('the horizon fade comes after an approach to the photon sphere', () => {
    const fall = allBeats.filter(({ b }) => b.fade === 'horizon').map(({ b }) => b);
    expect(fall.length).toBe(1);
    expect(fall[0].approach).toEqual({ rs: 1.5, hole: 'Sgr A*' });
  });
});
