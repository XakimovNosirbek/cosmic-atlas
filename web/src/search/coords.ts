/**
 * Sky coordinates typed into the search box, so a position from a paper or a catalogue can be looked
 * at directly. Accepted (ICRS unless galactic is said):
 *
 *   83.822 -5.391          83.822, -5.391           ra=83.822 dec=-5.391     (decimal degrees)
 *   05 35 17.3 -05 23 28   05:35:17.3 -05:23:28     05h35m17.3s -05d23m28s   (RA in hours, sexagesimal)
 *   l=209.01 b=-19.38      gal 209.01 -19.38        209.01 -19.38 gal        (Galactic degrees)
 *
 * Two bare decimal numbers are RA/Dec in degrees. A single number, a name with digits ("M 31",
 * "NGC 1976", "HD 197076") and anything out of range are not coordinates.
 */
export type SkyCoord = { frame: 'icrs'; ra: number; dec: number } | { frame: 'galactic'; l: number; b: number };

const NUM = String.raw`[+\-−]?\d+(?:\.\d+)?`;

function num(s: string): number {
  return Number(s.replace('−', '-'));
}

function inRange(c: SkyCoord): SkyCoord | null {
  if (c.frame === 'icrs') return c.ra >= 0 && c.ra < 360 && Math.abs(c.dec) <= 90 ? c : null;
  return Math.abs(c.b) <= 90 ? { frame: 'galactic', l: ((c.l % 360) + 360) % 360, b: c.b } : null;
}

/** "05 35 17.3" / "05:35:17.3" / "05h35m17.3s" → hours; "-05 23 28" / "-05d23m28s" → degrees */
function sexa(parts: string[]): number {
  const sign = /^[-−]/.test(parts[0]) ? -1 : 1;
  const [a, b = '0', c = '0'] = parts.map((p) => p.replace(/^[+\-−]/, ''));
  return sign * (Number(a) + Number(b) / 60 + Number(c) / 3600);
}

export function parseSkyCoord(input: string): SkyCoord | null {
  const q = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return null;

  // galactic: l=…, b=…  |  gal L B  |  L B gal
  let m = q.match(new RegExp(String.raw`^l\s*=\s*(${NUM})[ ,]+b\s*=\s*(${NUM})$`))
    ?? q.match(new RegExp(String.raw`^(?:gal|galactic)[ ,:]+(${NUM})[ ,]+(${NUM})$`))
    ?? q.match(new RegExp(String.raw`^(${NUM})[ ,]+(${NUM})[ ,]+(?:gal|galactic)$`));
  if (m) return inRange({ frame: 'galactic', l: num(m[1]), b: num(m[2]) });

  // ra=… dec=…
  m = q.match(new RegExp(String.raw`^ra\s*=\s*(${NUM})[ ,]+dec\s*=\s*(${NUM})$`));
  if (m) return inRange({ frame: 'icrs', ra: num(m[1]), dec: num(m[2]) });

  // two decimal numbers: degrees
  m = q.match(new RegExp(String.raw`^(${NUM})[ ,]+(${NUM})$`));
  if (m) return inRange({ frame: 'icrs', ra: num(m[1]), dec: num(m[2]) });

  // sexagesimal: 3 + 3 fields, with spaces, colons or h/m/s d/m/s marks
  const s = q.replace(/[hdms°'"′″]/g, ' ').replace(/:/g, ' ').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  const f = s.split(' ');
  if (f.length === 6 && f.every((x) => new RegExp(`^${NUM}$`).test(x))) {
    // the Dec part must be signed or the input must have used a separator, so "1 2 3 4 5 6" is not taken
    if (!/[+\-−]/.test(f[3]) && !/[:hd]/.test(q)) return null;
    return inRange({ frame: 'icrs', ra: sexa(f.slice(0, 3)) * 15, dec: sexa(f.slice(3)) });
  }
  return null;
}
