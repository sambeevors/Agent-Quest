import * as Phaser from 'phaser';
import type { AssetManifest, MapConfig } from '../data/map-config';
import { TILE_SIZE } from '../data/map-config';
import { shoreTiles } from '../data/shore';
import { getActiveTheme } from '../themes/registry';

/** Theme texture holding the shoreline pieces (see `data/shore.ts`). */
const SHORE_TEXTURE = 'terrain-shore';

/**
 * Renders the shipped village into a Phaser scene: its terrain tiles, the
 * shoreline those tiles imply, and its placed features (the lake's stones and
 * the jetty). When the map can't be fetched, VillageScene falls back to the
 * procedural TerrainRenderer instead.
 *
 * What this deliberately does NOT draw is roads and natural scatter. Both are
 * generated at runtime against the buildings that actually spawned — see
 * `data/desire-paths.ts` and `data/scenery.ts` — so a stale hand-placed layer
 * underneath would contradict them.
 */

export interface RenderedMap {
  /**
   * World-space bounds of every placed feature. The caller feeds these to the
   * scenery generator as keep-out ground, so generated trees don't grow out of
   * the middle of the lake.
   */
  featureBounds: Array<{ x: number; y: number; w: number; h: number }>;
  /**
   * The subset drawn at ground level (an explicit negative `depth`) — the
   * jetty. Heroes walk on these, so anything that sorts by its own y would
   * paint on top of one; the ducks are kept off them.
   */
  floorBounds: Array<{ x: number; y: number; w: number; h: number }>;
}

export function renderMapConfig(
  scene: Phaser.Scene,
  map: MapConfig,
  manifest: AssetManifest,
): RenderedMap {
  const baseInfo = manifest.tilesets.find((t) => t.key === map.baseTileset) ?? manifest.tilesets[0];
  if (baseInfo === undefined) {
    throw new Error(`No tileset available for base rendering`);
  }

  // Base ground layer
  scene.add.tileSprite(
    map.world.width / 2,
    map.world.height / 2,
    map.world.width,
    map.world.height,
    baseInfo.key,
    0, // first frame of the tileset as base fill
  ).setDepth(-1000);

  const terrain = scene.add.container(0, 0).setDepth(-800);

  // Painted terrain cells
  for (const [key, cell] of Object.entries(map.terrain)) {
    const [colStr, rowStr] = key.split(',');
    if (colStr === undefined || rowStr === undefined) continue;
    const col = parseInt(colStr, 10);
    const row = parseInt(rowStr, 10);
    if (!Number.isFinite(col) || !Number.isFinite(row)) continue;
    if (!scene.textures.exists(cell.tile.set)) continue;
    const sprite = scene.add.sprite(
      col * TILE_SIZE + TILE_SIZE / 2,
      row * TILE_SIZE + TILE_SIZE / 2,
      cell.tile.set,
      cell.tile.frame,
    );
    terrain.add(sprite);
  }

  // Shoreline, over the cells it edges and still inside the ground container,
  // so nothing that stands or swims ever sorts beneath it.
  if (scene.textures.exists(SHORE_TEXTURE)) {
    const cols = Math.ceil(map.world.width / TILE_SIZE);
    const rows = Math.ceil(map.world.height / TILE_SIZE);
    for (const t of shoreTiles(map.terrain, cols, rows)) {
      terrain.add(scene.add.image(
        t.col * TILE_SIZE + TILE_SIZE / 2,
        t.row * TILE_SIZE + TILE_SIZE / 2,
        SHORE_TEXTURE,
        t.frame,
      ));
    }
  }

  // Features — added top-level so Y-sorting works against NPCs/heroes. Depth
  // uses the sprite's *foot* Y (bottom edge), not its centre: an NPC walking in
  // front of a stone (NPC Y > foot Y) should cover it, while one standing
  // behind it stays hidden. A feature that is a floor rather than an object —
  // the jetty heroes arrive on — carries an explicit depth below the y-sorted
  // world instead, so a hero standing on it is never painted over.
  const featureBounds: RenderedMap['featureBounds'] = [];
  const floorBounds: RenderedMap['floorBounds'] = [];
  for (const d of map.decorations) {
    if (!scene.textures.exists(d.textureKey)) continue;
    const needsSprite = d.frame !== undefined || d.animated === true;
    const gameObj = needsSprite
      ? scene.add.sprite(d.x, d.y, d.textureKey, d.frame ?? 0)
      : scene.add.image(d.x, d.y, d.textureKey);
    gameObj.setScale(getActiveTheme().featureScale?.(d.textureKey, d.scale) ?? d.scale);
    if (d.tint !== undefined) gameObj.setTint(d.tint);
    if (d.animated === true && gameObj instanceof Phaser.GameObjects.Sprite) {
      const animKey = `${d.textureKey}:${d.animation ?? 'idle'}`;
      if (scene.anims.exists(animKey)) gameObj.play(animKey);
    }
    const footY = d.y + gameObj.displayHeight * 0.5;
    gameObj.setDepth(d.depth ?? footY);
    const bounds = {
      x: d.x - gameObj.displayWidth / 2,
      y: d.y - gameObj.displayHeight / 2,
      w: gameObj.displayWidth,
      h: gameObj.displayHeight,
    };
    featureBounds.push(bounds);
    if (d.depth !== undefined && d.depth < 0) floorBounds.push(bounds);
  }

  return { featureBounds, floorBounds };
}
