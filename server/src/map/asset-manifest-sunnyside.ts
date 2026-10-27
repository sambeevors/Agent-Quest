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

const SUNNYSIDE_BASE = '/assets/themes/sunnyside';

function buildTilesets(base: string): TilesetManifest[] {
  return [
    {
      key: 'terrain-grass',
      label: 'Terrain — Grass',
      path: `${base}/terrain/grass.png`,
      tileWidth: 64,
      tileHeight: 64,
      columns: 6,
      rows: 1,
    },
    {
      key: 'terrain-water',
      label: 'Terrain — Water',
      path: `${base}/terrain/water.png`,
      tileWidth: 64,
      tileHeight: 64,
      columns: 5,
      rows: 1,
    },
    {
      // 4x4-tile seamless grass mix used as the map's base tileSprite.
      key: 'terrain-meadow',
      label: 'Terrain — Meadow base',
      path: `${base}/terrain/meadow.png`,
      tileWidth: 256,
      tileHeight: 256,
      columns: 1,
      rows: 1,
    },
    {
      key: 'terrain-road',
      label: 'Terrain — Road',
      path: `${base}/terrain/road.png`,
      tileWidth: 64,
      tileHeight: 64,
      columns: 6,
      rows: 4,
    },
  ];
}

function buildDecorations(base: string): DecorationManifest[] {
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

  for (let i = 1; i <= 4; i++) add(`tree-${i}`, `Tree ${i}`, `${base}/scenery/tree-${i}.png`, 'tree');
  for (let i = 1; i <= 3; i++) add(`bush-${i}`, `Bush ${i}`, `${base}/scenery/bush-${i}.png`, 'bush');
  for (let i = 1; i <= 5; i++) add(`rock-${i}`, `Rock ${i}`, `${base}/scenery/rock-${i}.png`, 'rock');
  for (let i = 1; i <= 2; i++) add(`stump-${i}`, `Stump ${i}`, `${base}/scenery/stump-${i}.png`, 'stump');
  for (let i = 1; i <= 3; i++) add(`flower-${i}`, `Flowers ${i}`, `${base}/scenery/flower-${i}.png`, 'prop');

  // The lake itself is `terrain-water` cells (its shore is derived from them on
  // the client), so the only water-side feature is the jetty heroes arrive on.
  // Baked at the terrain's x4, so it places at scale 1.
  add('terrain-bridge', 'Jetty', `${base}/terrain/bridge.png`, 'prop', { defaultScale: 1.0 });

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

function buildProtectedBuildings(base: string, scaleFor: (id: string) => number): ProtectedBuildingManifest[] {
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
    path: `${base}/buildings/${id}.png`,
    activity,
    defaultScale: Number(scaleFor(id).toFixed(4)),
  }));
}

export function buildAssetManifestSunnyside(): AssetManifest {
  return buildBakedManifest(SUNNYSIDE_BASE, buildingScale);
}

/**
 * Any theme whose bake emits the same regular tree (same keys, same sheet
 * shapes) under its own base path — the Pokémon theme's bake does, so it
 * shares this table rather than copying it.
 */
export function buildBakedManifest(base: string, scaleFor: (id: string) => number): AssetManifest {
  return {
    tilesets: buildTilesets(base),
    decorations: buildDecorations(base),
    protectedBuildings: buildProtectedBuildings(base, scaleFor),
  };
}
