import type {
  AssetManifest,
  DecorationManifest,
  ProtectedBuildingManifest,
  TilesetManifest,
} from './types';

/**
 * Manifest for the `sunnyside` theme. Unlike the Tiny Swords manifest this
 * one is a short hand-written table: the bake pipeline
 * (scripts/bake-sunnyside/) emits a small, regular asset tree, so there is
 * nothing to scan and no per-folder metadata rules to apply.
 *
 * Building scales: the client derives each building's render scale from the
 * bake's measured doorway heights (see client/src/game/themes/sunnyside.ts);
 * the defaultScale here is the same formula precomputed —
 * 0.58 * (52 / doorHeight). A client test pins the two tables against each
 * other via the generated sheet metadata.
 */

const BASE = '/assets/themes/sunnyside';

function buildTilesets(): TilesetManifest[] {
  return [
    {
      key: 'terrain-grass',
      label: 'Terrain — Grass',
      path: `${BASE}/terrain/grass.png`,
      tileWidth: 64,
      tileHeight: 64,
      columns: 6,
      rows: 1,
    },
    {
      key: 'terrain-water',
      label: 'Terrain — Water',
      path: `${BASE}/terrain/water.png`,
      tileWidth: 64,
      tileHeight: 64,
      columns: 5,
      rows: 1,
    },
    {
      // 4x4-tile seamless grass mix used as the map's base tileSprite.
      key: 'terrain-meadow',
      label: 'Terrain — Meadow base',
      path: `${BASE}/terrain/meadow.png`,
      tileWidth: 256,
      tileHeight: 256,
      columns: 1,
      rows: 1,
    },
    {
      key: 'terrain-road',
      label: 'Terrain — Road',
      path: `${BASE}/terrain/road.png`,
      tileWidth: 64,
      tileHeight: 64,
      columns: 6,
      rows: 4,
    },
  ];
}

function buildDecorations(): DecorationManifest[] {
  const out: DecorationManifest[] = [];
  const add = (
    key: string,
    label: string,
    path: string,
    category: DecorationManifest['category'],
    extra: Partial<DecorationManifest> = {},
  ): void => {
    out.push({ key, label, path, category, group: '', folderPath: [], defaultScale: 0.45, ...extra });
  };

  for (let i = 1; i <= 4; i++) add(`tree-${i}`, `Tree ${i}`, `${BASE}/scenery/tree-${i}.png`, 'tree');
  for (let i = 1; i <= 3; i++) add(`bush-${i}`, `Bush ${i}`, `${BASE}/scenery/bush-${i}.png`, 'bush');
  for (let i = 1; i <= 5; i++) add(`rock-${i}`, `Rock ${i}`, `${BASE}/scenery/rock-${i}.png`, 'rock');
  for (let i = 1; i <= 2; i++) add(`stump-${i}`, `Stump ${i}`, `${BASE}/scenery/stump-${i}.png`, 'stump');
  for (let i = 1; i <= 3; i++) add(`flower-${i}`, `Flowers ${i}`, `${BASE}/scenery/flower-${i}.png`, 'prop');

  // The shipped village paints its lake as `terrain-water` cells with
  // `water-bg` decorations tucked under the shoreline — keep that key working.
  add('water-bg', 'Water', `${BASE}/terrain/water.png`, 'water', {
    frameWidth: 64,
    frameHeight: 64,
    defaultScale: 1.0,
  });
  add('terrain-bridge', 'Bridge', `${BASE}/terrain/bridge.png`, 'prop', { defaultScale: 1.0 });

  return out;
}

/** Doorway height (baked px) per building — mirror of the bake metadata.
 * The arena and farm are fenced enclosures; their "door" is the gate gap in
 * the fence, declared taller than a post so the fence renders around hero
 * height rather than towering over it. */
const DOOR_HEIGHT: Record<string, number> = {
  library: 64,
  forge: 52,
  tavern: 52,
  alchemist: 48,
  farm: 72,
  castle: 52,
  watchtower: 48,
  arena: 72,
};

function buildingScale(id: string): number {
  return 0.58 * (52 / DOOR_HEIGHT[id]!);
}

function buildProtectedBuildings(): ProtectedBuildingManifest[] {
  const defs: Array<[string, string, string]> = [
    ['library', 'Library', 'reading'],
    ['alchemist', 'Alchemist', 'debugging'],
    ['castle', 'Castle', 'thinking'],
    ['watchtower', 'Watchtower', 'reviewing'],
    ['farm', 'Farm', 'git'],
    ['tavern', 'Tavern', 'idle'],
    ['forge', 'Forge', 'editing'],
    ['arena', 'Arena', 'bash'],
  ];
  return defs.map(([id, label, activity]) => ({
    id,
    label,
    path: `${BASE}/buildings/${id}.png`,
    activity,
    defaultScale: Number(buildingScale(id).toFixed(4)),
  }));
}

export function buildAssetManifestSunnyside(): AssetManifest {
  return {
    tilesets: buildTilesets(),
    decorations: buildDecorations(),
    protectedBuildings: buildProtectedBuildings(),
  };
}
