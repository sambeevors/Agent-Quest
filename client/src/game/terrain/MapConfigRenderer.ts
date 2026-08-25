import * as Phaser from 'phaser';
import type { AssetManifest, MapConfig } from '../data/map-config';
import { TILE_SIZE } from '../data/map-config';

/**
 * Renders the shipped village into a Phaser scene: its terrain tiles and its
 * placed features (the lake, the mines, the bridge, the odd tower). When the
 * map can't be fetched, VillageScene falls back to the procedural
 * TerrainRenderer instead.
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

  // Features — added top-level so Y-sorting works against NPCs/heroes. Depth
  // uses the sprite's *foot* Y (bottom edge), not its centre: an NPC walking in
  // front of a tower (NPC Y > foot Y) should cover it, while one standing
  // behind it stays hidden.
  const featureBounds: RenderedMap['featureBounds'] = [];
  for (const d of map.decorations) {
    if (!scene.textures.exists(d.textureKey)) continue;
    const needsSprite = d.frame !== undefined || d.animated === true;
    const gameObj = needsSprite
      ? scene.add.sprite(d.x, d.y, d.textureKey, d.frame ?? 0)
      : scene.add.image(d.x, d.y, d.textureKey);
    gameObj.setScale(d.scale);
    if (d.tint !== undefined) gameObj.setTint(d.tint);
    if (d.animated === true && gameObj instanceof Phaser.GameObjects.Sprite) {
      const animKey = `${d.textureKey}:${d.animation ?? 'idle'}`;
      if (scene.anims.exists(animKey)) gameObj.play(animKey);
    }
    const footY = d.y + gameObj.displayHeight * 0.5;
    gameObj.setDepth(d.depth ?? footY);
    featureBounds.push({
      x: d.x - gameObj.displayWidth / 2,
      y: d.y - gameObj.displayHeight / 2,
      w: gameObj.displayWidth,
      h: gameObj.displayHeight,
    });
  }

  return { featureBounds };
}
