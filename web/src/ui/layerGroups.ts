/**
 * Groups of the layers panel, in display order. A layer's group comes from its id, then from its
 * swatch (the kind of thing it draws), so a new layer lands somewhere sensible without a table edit.
 */
export const LAYER_GROUPS = ['solar', 'stars', 'galaxies', 'sky'] as const;
export type LayerGroup = (typeof LAYER_GROUPS)[number];

const BY_ID: Record<string, LayerGroup> = {
  solar: 'solar', 'small-bodies': 'solar', satellites: 'solar',
  'star-clusters': 'stars', 'milky-way-model': 'stars', dust: 'stars', constellations: 'stars',
  'local-group': 'galaxies', 'local-volume': 'galaxies',
  'gaia-sky': 'sky', cmb: 'sky', 'gw-volumes': 'sky', frb: 'sky', neutrinos: 'sky',
};

export function layerGroup(id: string, swatch = ''): LayerGroup {
  if (BY_ID[id]) return BY_ID[id];
  if (id.startsWith('stars-') || id === 'synthetic-stars') return 'stars';
  if (id.startsWith('galaxies-') || id === 'synthetic-galaxies') return 'galaxies';
  if (swatch === 'star' || swatch === 'model' || swatch === 'dust') return 'stars';
  if (swatch === 'galaxy') return 'galaxies';
  if (swatch === 'solar') return 'solar';
  return 'sky';
}
