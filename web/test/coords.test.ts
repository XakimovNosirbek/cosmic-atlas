import { describe, expect, it } from 'vitest';
import { parseSkyCoord } from '../src/search/coords';

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('sky coordinates in the search box', () => {
  it('reads decimal degrees in several spellings', () => {
    for (const q of ['83.822 -5.391', '83.822, -5.391', 'ra=83.822 dec=-5.391', '  83.822   −5.391 ']) {
      const c = parseSkyCoord(q);
      expect(c, q).toEqual({ frame: 'icrs', ra: 83.822, dec: -5.391 });
    }
  });

  it('reads sexagesimal RA in hours (M42: 05h35m17.3s −05°23′28″)', () => {
    for (const q of ['05 35 17.3 -05 23 28', '05:35:17.3 -05:23:28', '05h35m17.3s -05d23m28s', '5h35m17.3s −5°23′28″']) {
      const c = parseSkyCoord(q);
      expect(c?.frame, q).toBe('icrs');
      if (c?.frame !== 'icrs') continue;
      close(c.ra, (5 + 35 / 60 + 17.3 / 3600) * 15);
      close(c.dec, -(5 + 23 / 60 + 28 / 3600));
    }
  });

  it('reads Galactic l, b', () => {
    for (const q of ['l=209.01 b=-19.38', 'gal 209.01 -19.38', '209.01 -19.38 gal', 'galactic: 209.01, -19.38']) {
      expect(parseSkyCoord(q), q).toEqual({ frame: 'galactic', l: 209.01, b: -19.38 });
    }
    expect(parseSkyCoord('l=-10 b=5')).toEqual({ frame: 'galactic', l: 350, b: 5 });
  });

  it('leaves names, single numbers and out-of-range values to the name search', () => {
    for (const q of ['M 31', 'NGC 1976', 'HD 197076', '42', 'Gaia DR3 6879230671125485312', '400 10', '10 95', 'l=10 b=100', '1 2 3 4 5 6', 'Mars']) {
      expect(parseSkyCoord(q), q).toBeNull();
    }
  });
});
