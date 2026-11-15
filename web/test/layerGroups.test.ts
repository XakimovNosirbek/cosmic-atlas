import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LAYER_GROUPS, layerGroup } from '../src/ui/layerGroups';

describe('layer groups', () => {
  it('puts every layer of layers.json in a group, Solar System first and sky signals last', () => {
    const m = JSON.parse(readFileSync(resolve(import.meta.dirname, '../public/layers.json'), 'utf8'));
    const ids: string[] = (m.layers ?? m).map((l: { id: string }) => l.id);
    const g = Object.fromEntries(ids.map((id) => [id, layerGroup(id)]));
    expect(g['stars-gaia']).toBe('stars');
    expect(g['galaxies-desi']).toBe('galaxies');
    expect(g['small-bodies']).toBe('solar');
    expect(g['neutrinos']).toBe('sky');
    expect(ids.every((id) => (LAYER_GROUPS as readonly string[]).includes(g[id]))).toBe(true);
  });

  it('places unknown layers by id prefix, then by swatch', () => {
    expect(layerGroup('galaxies-euclid')).toBe('galaxies');
    expect(layerGroup('stars-hipparcos-extra')).toBe('stars');
    expect(layerGroup('something', 'galaxy')).toBe('galaxies');
    expect(layerGroup('something')).toBe('sky');
  });

  it('has a heading in every language for every group', () => {
    for (const lang of ['en', 'uz', 'ru']) {
      const s = JSON.parse(readFileSync(resolve(import.meta.dirname, `../src/i18n/${lang}.json`), 'utf8'));
      for (const g of LAYER_GROUPS) expect(s[`layers.group.${g}`], `${lang} layers.group.${g}`).toBeTruthy();
    }
  });
});
