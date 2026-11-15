/**
 * The narrative tours (black holes, the Milky Way, the life of a star, the universe, the Solar
 * System), as data. Loaded with the tours menu (its own chunk, with its uz / en / ru captions in
 * tour/narrative/*.json), so none of it is part of the first download.
 *
 * Numbers in the captions come from the docs articles named in each stop's `doc`, from the
 * catalogue entries the stop selects, or are computed (black hole numbers: bhfacts.ts);
 * test/narrative.test.ts checks every number of the English captions against those sources and
 * that the uz / ru captions carry the same numbers.
 */

import { extendDicts } from '../i18n';
import type { Vec3 } from '../math/frames';
import en from './narrative/en.json';
import ru from './narrative/ru.json';
import uz from './narrative/uz.json';
import { SCALE_TOUR, type Beat, type Tour } from './tours';

extendDicts({ uz, en, ru });

/** catalogue positions (data/tiles/catalogs), used only when a catalogue has not loaded */
const P: Record<string, Vec3> = {
  bh3: [366, 462, -35.93],
  sgra: [8277, -8.056, -6.668],
  m87: [1069823, -4362852, 16188298],
  gw150914: [80258600, -344132000, -198674000],
  m42: [-357, -198, -144],
  m45: [-120, 28.8, -53.92],
  betelgeuse: [-140.8, -50.8, -23.6],
  helix: [87.77, 64.14, -168],
  sirius: [-1.77, -1.91, -0.41],
  m1: [-1984, -158, -202],
  crabPsr: [-1984, -158, -202],
  lmc: [7715, -41769, -27467],
  smc: [24801, -38487, -44680],
  m31: [-377129, 623346, -288055],
  virgo: [1093295, -4352872, 16079145],
  laniakea: [128780510, 77888121, -37461753],
  proxima: [0.9024, -0.9364, -0.0438],
};

/** the ecliptic north pole in Galactic coordinates (l, b): the Solar System seen from above */
const ECLIPTIC_POLE = { yawDeg: 96.38, pitchDeg: 29.81 };
/** supergalactic north pole (search/aliases.ts SG_POLE) */
const SG_POLE = { yawDeg: 47.37, pitchDeg: 6.32 };
const AU = 4.84813681109536e-6; // pc

const bh3 = { catalog: ['Gaia BH3'], fallback: P.bh3 };
const sgra = { catalog: ['Sgr A*', 'Sagittarius A*'], fallback: P.sgra };
const m87 = { catalog: ['M87*'], fallback: P.m87 };
const beat = (b: Omit<Beat, 'title' | 'text'> & { key: string }): Beat => {
  const { key, ...rest } = b;
  return { ...rest, title: `nt.${key}.title`, text: `nt.${key}.text` };
};

export const BLACK_HOLE_TOUR: Tour = {
  id: 'black-holes', label: 'nt.bh.title', summary: 'nt.bh.summary', narrative: true,
  beats: [
    beat({ key: 'bh.intro', id: 'intro', target: bh3, earthSide: true, dist: 250, pitchDeg: 12, yawDeg: 25, orbitDeg: 20, dwellMs: 0,
      select: ['Gaia BH3'], doc: 'black-hole' }),
    beat({ key: 'bh.bh3', id: 'bh3', target: bh3, earthSide: true, dist: { rs: 3000, hole: 'Gaia BH3' }, approach: { rs: 60, hole: 'Gaia BH3' },
      pitchDeg: 0, dwellMs: 0, bh: { hole: 'Gaia BH3', disk: false, flamm: false }, facts: [['Gaia BH3', 'bh3']], doc: 'gaia-bh3' }),
    beat({ key: 'bh.ring', id: 'ring', target: bh3, earthSide: true, dist: { rs: 30, hole: 'Gaia BH3' }, pitchDeg: 0, orbitDeg: 150, dwellMs: 0,
      bh: { hole: 'Gaia BH3', flamm: false }, doc: 'black-hole' }),
    beat({ key: 'bh.time', id: 'time', target: bh3, earthSide: true, dist: { rs: 25, hole: 'Gaia BH3' }, approach: { rs: 6, hole: 'Gaia BH3' },
      pitchDeg: 8, dwellMs: 0, bh: { hole: 'Gaia BH3', flamm: true }, facts: [['Gaia BH3', 'bh3']], doc: 'black-hole' }),
    beat({ key: 'bh.tides', id: 'tides', target: bh3, earthSide: true, dist: { rs: 6, hole: 'Gaia BH3' }, approach: { rs: 3, hole: 'Gaia BH3' },
      pitchDeg: 8, dwellMs: 0, bh: { hole: 'Gaia BH3', flamm: true }, facts: [['Gaia BH3', 'bh3']], doc: 'black-hole' }),
    beat({ key: 'bh.photon', id: 'photon', target: bh3, earthSide: true, dist: { rs: 3, hole: 'Gaia BH3' }, approach: { rs: 1.5, hole: 'Gaia BH3' },
      pitchDeg: 8, dwellMs: 0, bh: { hole: 'Gaia BH3', flamm: true }, facts: [['Gaia BH3', 'bh3'], ['Sgr A*', 'sgr']], doc: 'black-hole' }),
    beat({ key: 'bh.sgra', id: 'sgra', target: sgra, earthSide: true, dist: { rs: 25, hole: 'Sgr A*' }, pitchDeg: 0, orbitDeg: 30, dwellMs: 0,
      bh: { hole: 'Sgr A*', disk: true, flamm: false }, facts: [['Sgr A*', 'sgr']], doc: 'sgr-a-star' }),
    beat({ key: 'bh.fall', id: 'fall', target: sgra, earthSide: true, dist: { rs: 25, hole: 'Sgr A*' }, approach: { rs: 1.5, hole: 'Sgr A*' },
      pitchDeg: 0, dwellMs: 0, fade: 'horizon', bh: { hole: 'Sgr A*', disk: false, flamm: false }, doc: 'black-hole' }),
    beat({ key: 'bh.m87', id: 'm87', target: m87, earthSide: true, dist: { rs: 25, hole: 'M87*' }, pitchDeg: 0, orbitDeg: 25, dwellMs: 0,
      bh: { hole: 'M87*', disk: true, flamm: false }, facts: [['M87*', 'm87']], doc: 'm87-black-hole' }),
    beat({ key: 'bh.gw', id: 'gw', target: { catalog: ['GW150914'], fallback: P.gw150914 }, dist: 1.6e9, pitchDeg: 25, orbitDeg: 40, dwellMs: 0,
      show: ['gw-volumes'], select: ['GW150914'], doc: 'gravitational-waves' }),
  ],
};

export const MILKY_WAY_TOUR: Tour = {
  id: 'milky-way', label: 'nt.mw.title', summary: 'nt.mw.summary', narrative: true,
  beats: [
    beat({ key: 'mw.sun', id: 'sun', target: { sun: true }, dist: 4, pitchDeg: 20, orbitDeg: 50, dwellMs: 0, doc: 'milky-way' }),
    beat({ key: 'mw.near', id: 'near', target: { sun: true }, dist: 1100, pitchDeg: 30, orbitDeg: 60, dwellMs: 0, show: ['stars-gaia'], doc: 'gaia-mission' }),
    beat({ key: 'mw.orion', id: 'orion', target: { catalog: ['M42', 'Orion Nebula'], fallback: P.m42 }, dist: 40, pitchDeg: 15, orbitDeg: 40, dwellMs: 0,
      select: ['M42', 'Orion Nebula'], doc: 'nebula' }),
    beat({ key: 'mw.pleiades', id: 'pleiades', target: { catalog: ['M45', 'Pleiades'], fallback: P.m45 }, dist: 12, pitchDeg: 20, orbitDeg: 60, dwellMs: 0,
      select: ['M45', 'Pleiades'], doc: 'star-cluster' }),
    beat({ key: 'mw.dust', id: 'dust', target: { sun: true }, dist: 2600, pitchDeg: 32, yawDeg: 20, orbitDeg: 40, dwellMs: 0, show: ['dust'],
      needs: ['dust'], doc: 'milky-way' }),
    beat({ key: 'mw.arms', id: 'arms', target: { gc: true }, dist: 7e4, pitchDeg: 87.5, orbitDeg: 30, dwellMs: 0, show: ['milky-way-model'], doc: 'milky-way' }),
    beat({ key: 'mw.centre', id: 'centre', target: sgra, dist: 2500, pitchDeg: 25, orbitDeg: 30, dwellMs: 0, show: ['milky-way-model'],
      facts: [['Sgr A*', 'sgr']], doc: 'sgr-a-star' }),
    beat({ key: 'mw.orbits', id: 'orbits', target: { sun: true }, dist: 600, pitchDeg: 35, dwellMs: 0, show: ['stars-gaia'],
      epochAnim: { from: 0, to: 30 }, doc: 'milky-way' }),
    beat({ key: 'mw.clouds', id: 'clouds',
      target: { between: [{ catalog: ['LMC', 'Large Magellanic Cloud'], fallback: P.lmc }, { catalog: ['SMC', 'Small Magellanic Cloud'], fallback: P.smc }], t: 0.5 },
      dist: 6e4, pitchDeg: 25, orbitDeg: 40, dwellMs: 0, doc: 'local-group' }),
    beat({ key: 'mw.m31', id: 'm31', target: { catalog: ['Andromeda (M31)', 'M31'], fallback: P.m31 }, dist: 5e4, pitchDeg: 30, orbitDeg: 30, dwellMs: 0,
      select: ['Andromeda (M31)', 'M31'], doc: 'local-group' }),
  ],
};

export const STAR_LIFE_TOUR: Tour = {
  id: 'star-life', label: 'nt.life.title', summary: 'nt.life.summary', narrative: true,
  beats: [
    beat({ key: 'life.cloud', id: 'cloud', target: { catalog: ['M42', 'Orion Nebula'], fallback: P.m42 }, dist: 25, pitchDeg: 10, orbitDeg: 30, dwellMs: 0,
      select: ['M42', 'Orion Nebula'], doc: 'nebula' }),
    beat({ key: 'life.cluster', id: 'cluster', target: { catalog: ['M45', 'Pleiades'], fallback: P.m45 }, dist: 10, pitchDeg: 20, orbitDeg: 60, dwellMs: 0,
      select: ['M45', 'Pleiades'], doc: 'star-cluster' }),
    beat({ key: 'life.sun', id: 'sun', target: { solar: 'Sun' }, dist: 0, pitchDeg: 0, orbitDeg: 30, dwellMs: 0, show: ['solar'], doc: 'sun' }),
    beat({ key: 'life.giant', id: 'giant', target: { catalog: ['Betelgeuse'], fallback: P.betelgeuse }, dist: 2, pitchDeg: 15, orbitDeg: 40, dwellMs: 0,
      select: ['Betelgeuse'], doc: 'star' }),
    beat({ key: 'life.pn', id: 'pn', target: { catalog: ['NGC 7293', 'Helix Nebula'], fallback: P.helix }, dist: 4, pitchDeg: 15, orbitDeg: 40, dwellMs: 0,
      select: ['NGC 7293', 'Helix Nebula'], doc: 'nebula' }),
    beat({ key: 'life.wd', id: 'wd', target: { catalog: ['Sirius'], fallback: P.sirius }, dist: 0.15, pitchDeg: 15, orbitDeg: 40, dwellMs: 0,
      select: ['Sirius'], doc: 'white-dwarf' }),
    beat({ key: 'life.sn', id: 'sn', target: { catalog: ['M1', 'Crab Nebula'], fallback: P.m1 }, dist: 15, pitchDeg: 15, orbitDeg: 40, dwellMs: 0,
      select: ['M1', 'Crab Nebula'], doc: 'supernova-remnant' }),
    beat({ key: 'life.pulsar', id: 'pulsar', target: { catalog: ['PSR J0534+2200', 'Crab Pulsar'], fallback: P.crabPsr }, dist: 0.3, pitchDeg: 15, orbitDeg: 40, dwellMs: 0,
      select: ['PSR J0534+2200', 'Crab Pulsar'], doc: 'pulsar' }),
    beat({ key: 'life.bh', id: 'bh', target: bh3, earthSide: true, dist: { rs: 40, hole: 'Gaia BH3' }, pitchDeg: 0, orbitDeg: 90, dwellMs: 0,
      bh: { hole: 'Gaia BH3', disk: false, flamm: false }, facts: [['Gaia BH3', 'bh3']], doc: 'gaia-bh3' }),
  ],
};

export const UNIVERSE_TOUR: Tour = {
  id: 'universe', label: 'nt.uni.title', summary: 'nt.uni.summary', narrative: true,
  beats: [
    beat({ key: 'uni.lg', id: 'lg', target: { between: [{ gc: true }, { catalog: ['Andromeda (M31)', 'M31'], fallback: P.m31 }], t: 0.4 },
      dist: 2.6e6, pitchDeg: 29, orbitDeg: 40, dwellMs: 0, doc: 'local-group' }),
    beat({ key: 'uni.virgo', id: 'virgo', target: { catalog: ['Virgo Cluster'], fallback: P.virgo }, dist: 1.2e7, pitchDeg: 25, orbitDeg: 30, dwellMs: 0,
      select: ['Virgo Cluster'], doc: 'laniakea' }),
    beat({ key: 'uni.laniakea', id: 'laniakea', target: { catalog: ['Laniakea'], fallback: P.laniakea }, dist: 5e8, ...SG_POLE, dwellMs: 0,
      show: ['galaxies-2mrs', 'cf4-flow', 'sg-grid'], needs: ['cf4-flow'], doc: 'laniakea',
      // the deep surveys and GW volumes bury the streamlines (search/focus.ts DEEP_FOR_FLOWS)
      hide: ['galaxies-desi', 'galaxies-sdss', 'galaxies-6dfgs', 'galaxies-2dfgrs', 'gw-volumes'] }),
    beat({ key: 'uni.web', id: 'web', target: { sun: true }, dist: 1.5e9, pitchDeg: 29, dwellMs: 0, show: ['galaxies-desi'], slab: 75,
      hide: ['cf4-flow', 'cf4-density', 'sg-grid'], needs: ['galaxies-desi'], doc: 'cosmic-web' }),
    beat({ key: 'uni.quasars', id: 'quasars', target: { sun: true }, dist: 1.2e10, pitchDeg: 20, yawDeg: -150, orbitDeg: 30, dwellMs: 0,
      show: ['galaxies-desi'], slab: 0, needs: ['galaxies-desi'], doc: 'quasar' }),
    beat({ key: 'uni.cmb', id: 'cmb', target: { sun: true }, dist: 3e10, pitchDeg: 20, orbitDeg: 30, dwellMs: 0, show: ['cmb'], doc: 'cmb' }),
    beat({ key: 'uni.expansion', id: 'expansion', target: { sun: true }, dist: 9e9, pitchDeg: 25, orbitDeg: 45, dwellMs: 0, show: ['galaxies-desi'],
      doc: 'redshift' }),
  ],
};

export const SOLAR_SYSTEM_TOUR: Tour = {
  id: 'solar-system', label: 'nt.sol.title', summary: 'nt.sol.summary', narrative: true,
  beats: [
    beat({ key: 'sol.sun', id: 'sun', target: { solar: 'Sun' }, dist: 0, pitchDeg: 0, orbitDeg: 30, dwellMs: 0, show: ['solar'], doc: 'sun' }),
    beat({ key: 'sol.planets', id: 'planets', target: { sun: true }, dist: 33 * AU, ...ECLIPTIC_POLE, dwellMs: 0, show: ['solar'], doc: 'solar-system' }),
    beat({ key: 'sol.belt', id: 'belt', target: { sun: true }, dist: 12 * AU, ...ECLIPTIC_POLE, dwellMs: 0, show: ['solar', 'small-bodies'],
      doc: 'asteroid-belt' }),
    beat({ key: 'sol.comet', id: 'comet', target: { solar: '1P/Halley' }, dist: 0, pitchDeg: 0, dwellMs: 0, show: ['solar', 'small-bodies'], doc: 'comet' }),
    beat({ key: 'sol.moon', id: 'moon', target: { solar: 'Tycho' }, dist: 0, pitchDeg: 0, dwellMs: 0, show: ['solar'], clock: '2026-11-24T20:00:00Z',
      doc: 'moon' }),
    beat({ key: 'sol.mars', id: 'mars', target: { solar: 'Gale' }, dist: 0, pitchDeg: 0, dwellMs: 0, show: ['solar'],
      // daylight at Gale too (Sun 69° up then, Tycho 48°: SolarSystem.sunElevation)
      clock: '2026-11-24T20:00:00Z', doc: 'mars' }),
    beat({ key: 'sol.voyager', id: 'voyager', target: { solar: 'Voyager 1' }, dist: 0, pitchDeg: 0, orbitDeg: 30, dwellMs: 0, show: ['solar'], doc: 'voyager-1' }),
    beat({ key: 'sol.proxima', id: 'proxima', target: { catalog: ['Proxima Centauri'], fallback: P.proxima }, dist: 1.6, pitchDeg: 17, orbitDeg: 30, dwellMs: 0,
      select: ['Proxima Centauri'], doc: 'proxima-b' }),
  ],
};

/** the tours menu, in order; the scale tour (powers of ten) is the last entry */
export const TOURS: Tour[] = [BLACK_HOLE_TOUR, MILKY_WAY_TOUR, STAR_LIFE_TOUR, UNIVERSE_TOUR, SOLAR_SYSTEM_TOUR, SCALE_TOUR];
