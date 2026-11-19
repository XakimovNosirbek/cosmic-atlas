import { describe, expect, it } from 'vitest';
import { MAX_STATES, cleanName, decodeStory, encodeStory, loadStates, sanitize, stateBeat, storeStates, storyTour } from '../src/state/states';
import { formatHash, parseHash } from '../src/state/hash';

const A = { name: 'Gliese 710 passes', hash: '#v=0.1,0.2,0.3,2.5,-120.00,30.00&l=~gaia-sky&ty=1294000&sel=stars-gaia:4270814637616488064@-18.1,5.2,0.9' };
const B = { name: 'Солнечная окрестность −50 млн лет', hash: '#v=0,0,0,400,-120.00,32.00&ty=-50000000' };
const C = { name: 'Andromeda', hash: '#at=Andromeda%20(M31)&d=3e5,10.0,20.0' };

describe('saved views (state/states.ts)', () => {
  it('keeps well-formed states and drops the rest', () => {
    const out = sanitize([A, B, C, { name: '', hash: A.hash }, { name: 'x', hash: '#l=dust' }, { name: 'nolook', hash: '#at=Saturn' }, null, 7, { name: 'y' }]);
    expect(out.map((s) => s.name)).toEqual([A.name, B.name, C.name]);
    // hashes are re-written in canonical form and one-shot params never survive
    expect(sanitize([{ name: 'z', hash: `${B.hash}&focus=M31&story=abc` }])[0].hash).toBe(B.hash);
    expect(sanitize(Array.from({ length: 40 }, () => B))).toHaveLength(MAX_STATES);
    expect(sanitize('nope')).toEqual([]);
    expect(cleanName('  a\u0000b \n c  ')).toBe('a b c');
  });

  it('round-trips a story link, Unicode names included', () => {
    const v = encodeStory([A, B, C]);
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeStory(v)).toEqual(sanitize([A, B, C]));
    expect(parseHash(`#story=${v}`).story).toBe(v);
    expect(decodeStory('!!!')).toEqual([]);
    expect(decodeStory('e30')).toEqual([]); // '{}'
  });

  it('turns a state into a tour beat with its camera, layers, epoch and selection', () => {
    const b = stateBeat(A, 0);
    expect(b.target).toEqual({ xyz: [0.1, 0.2, 0.3] });
    expect(b).toMatchObject({ dist: 2.5, yawDeg: -120, pitchDeg: 30, epochMyr: 1.294, layers: { 'gaia-sky': false }, caption: { title: A.name, text: '' } });
    expect(b.sel).toEqual({ type: 'point', layer: 'stars-gaia', id: '4270814637616488064', xyz: [-18.1, 5.2, 0.9] });
    const c = stateBeat(C, 2);
    expect(c.target).toEqual({ catalog: ['Andromeda (M31)'], fallback: [0, 0, 0] });
    expect(c).toMatchObject({ dist: 3e5, yawDeg: 10, pitchDeg: 20, epochMyr: 0, layers: {} });
    const tour = storyTour([A, B, C]);
    expect(tour.beats).toHaveLength(3);
    expect(tour.keepScene).toBe(true);
    expect(tour.stayAtEnd).toBe(true);
  });

  it('survives a missing localStorage (node, private mode)', () => {
    expect(loadStates()).toEqual([]);
    expect(storeStates([A])).toBe(false);
  });

  it('the hash carries the epoch to ±100 Myr', () => {
    expect(parseHash(formatHash({ view: { focus: [0, 0, 0], dist: 400, yawDeg: 0, pitchDeg: 0 }, epochYr: -5e7 })).epochYr).toBe(-5e7);
  });
});
