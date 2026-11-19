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
const DEC_NUM = String.raw`[+\-−]?\d+(?:[.,]\d+)?`;
const UNSIGNED_NUM = String.raw`\d+(?:\.\d+)?`;

function num(s: string): number {
  return Number(s.replace('−', '-').replace(',', '.'));
}

function inRange(c: SkyCoord): SkyCoord | null {
  if (c.frame === 'icrs') return c.ra >= 0 && c.ra < 360 && Math.abs(c.dec) <= 90 ? c : null;
  return Math.abs(c.b) <= 90 ? { frame: 'galactic', l: ((c.l % 360) + 360) % 360, b: c.b } : null;
}

/** "05 35 17.3" / "05:35:17.3" / "05h35m17.3s" → hours; "-05 23 28" / "-05d23m28s" → degrees */
function sexa(parts: string[]): number | null {
  const sign = /^[-−]/.test(parts[0]) ? -1 : 1;
  const aStr = parts[0].replace(/^[+\-−]/, '');
  if (!/^\d+$/.test(aStr)) return null;
  const bStr = parts[1] ?? '0';
  const cStr = parts[2] ?? '0';
  if (!new RegExp(`^${UNSIGNED_NUM}$`).test(bStr) || !new RegExp(`^${UNSIGNED_NUM}$`).test(cStr)) return null;
  const a = Number(aStr);
  const b = Number(bStr);
  const c = Number(cStr);
  if (b >= 60 || c >= 60) return null;
  if (parts.length === 3 && !/^\d+$/.test(bStr)) return null;
  return sign * (a + b / 60 + c / 3600);
}

export function parseSkyCoord(input: string): SkyCoord | null {
  const q = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return null;

  // galactic: l=…, b=…  |  gal L B  |  L B gal
  let m = q.match(new RegExp(String.raw`^l\s*[:=]\s*(${DEC_NUM})(?:°)?[ ,;]+b\s*[:=]\s*(${DEC_NUM})(?:°)?$`))
    ?? q.match(new RegExp(String.raw`^(?:gal|galactic)[ ,:]+(${DEC_NUM})(?:°)?(?:,\s+|\s+)(${DEC_NUM})(?:°)?$`))
    ?? q.match(new RegExp(String.raw`^(${DEC_NUM})(?:°)?(?:,\s+|\s+)(${DEC_NUM})(?:°)?[ ,]+(?:gal|galactic)$`));
  if (m) return inRange({ frame: 'galactic', l: num(m[1]), b: num(m[2]) });

  // ra=… dec=…  (or ra: … dec: …)
  m = q.match(new RegExp(String.raw`^ra\s*[:=]\s*(${DEC_NUM})(?:°)?[ ,;]+dec\s*[:=]\s*(${DEC_NUM})(?:°)?$`));
  if (m) return inRange({ frame: 'icrs', ra: num(m[1]), dec: num(m[2]) });

  // two decimal numbers: degrees (also accepts localized comma-decimal pairs like "83,8220, -5,3910")
  m = q.match(new RegExp(String.raw`^(${NUM})(?:°)?[ ,]+(${NUM})(?:°)?$`))
    ?? q.match(new RegExp(String.raw`^(${DEC_NUM})(?:°)?(?:,\s+|\s+)(${DEC_NUM})(?:°)?$`));
  if (m) return inRange({ frame: 'icrs', ra: num(m[1]), dec: num(m[2]) });

  // sexagesimal: 3 + 3 or 2 + 2 fields, with spaces, colons or h/m/s d/m/s marks
  const s = q.replace(/[hdms°'"′″]/g, ' ').replace(/:/g, ' ').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  const f = s.split(' ');
  if (f.length === 6 && f.every((x) => new RegExp(`^${NUM}$`).test(x))) {
    // the Dec part must be signed or the input must have used a separator, so "1 2 3 4 5 6" is not taken
    if (!/[+\-−]/.test(f[3]) && !/[:hd°′″]/.test(q)) return null;
    if (/^[+\-−]?\d+\s*[d°]/.test(q)) return null; // RA written in degrees, not hours
    const raH = sexa(f.slice(0, 3));
    const dec = sexa(f.slice(3));
    if (raH === null || dec === null || raH < 0) return null;
    return inRange({ frame: 'icrs', ra: raH * 15, dec });
  }
  if (f.length === 4 && /[:hd°′]/.test(q) && f.every((x) => new RegExp(`^${NUM}$`).test(x))) {
    if (/^[+\-−]?\d+\s*[d°]/.test(q)) return null;
    const raH = sexa(f.slice(0, 2));
    const dec = sexa(f.slice(2));
    if (raH === null || dec === null || raH < 0) return null;
    return inRange({ frame: 'icrs', ra: raH * 15, dec });
  }
  return null;
}
