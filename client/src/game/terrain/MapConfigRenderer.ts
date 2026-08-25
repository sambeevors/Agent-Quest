import * as Phaser from 'phaser';
import type { AssetManifest, MapConfig } from '../../editor/types/map';
import { TILE_SIZE } from '../../editor/types/map';

/**
 * Renders a user-saved MapConfig into a Phaser scene. Used by VillageScene when
 * a custom map was built in the editor. When no MapConfig is present, the
 * scene falls back to the procedural TerrainRenderer instead.
 */

interface Containers {
  base: Phaser.GameObjects.TileSprite;
  terrain: Phaser.GameObjects.Container;
  paths: Phaser.GameObjects.Container;
  /**
   * World-space bounds of every PLACED feature that survived (water, mines,
   * props). The caller feeds these to the scenery generator as keep-out
   * ground, so generated trees don't grow out of the lake.
   */
  featureBounds: Array<{ x: number; y: number; w: number; h: number }>;
}

/**
 * Texture-key prefixes for natural clutter. These are regenerated procedurally
 * against the current buildings and roads (see data/scenery.ts), so whatever a
 * saved map has for them is stale by definition — the map editor had no idea
 * where this fork's hamlet or its generated lanes would end up.
 *
 * Everything NOT matching is a deliberately placed feature — water, a gold
 * mine, a tower — and is drawn as saved.
 */
const SCATTER_PREFIXES = ['tree-', 'bush-', 'rock-', 'stump-', 'mushroom-', 'deco-', 'resources-trees-'];

function isScatter(textureKey: string): boolean {
  return SCATTER_PREFIXES.some((prefix) => textureKey.startsWith(prefix));
}

/** Rect in world space; scenery whose anchor falls inside one is not drawn. */
export interface ClearZone {
  x: number;
  y: number;
  w: number;
  h: number;
}

function insideAny(x: number, y: number, zones: readonly ClearZone[]): boolean {
  for (const z of zones) {
    if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) return true;
  }
  return false;
}

export function renderMapConfig(
  scene: Phaser.Scene,
  map: MapConfig,
  manifest: AssetManifest,
  /**
   * Ground reserved for things the editor doesn't know about — currently the
   * Linear hamlet. Decorations here are skipped so the settlement stands in a
   * clearing rather than having the saved map's trees growing through it.
   */
  clearZones: readonly ClearZone[] = [],
): Containers {
  const baseInfo = manifest.tilesets.find((t) => t.key === map.baseTileset) ?? manifest.tilesets[0];
  if (baseInfo === undefined) {
    throw new Error(`No tileset available for base rendering`);
  }

  // Base ground layer
  const base = scene.add.tileSprite(
    map.world.width / 2,
    map.world.height / 2,
    map.world.width,
    map.world.height,
    baseInfo.key,
    0, // first frame of the tileset as base fill
  ).setDepth(-1000);

  const terrain = scene.add.container(0, 0).setDepth(-800);
  const paths = scene.add.container(0, 0).setDepth(-400);
  // Decorations are added directly to the scene (not wrapped in a container) so
  // each sprite's Y-based depth can freely interleave with NPCs and heroes for
  // correct perspective sorting. A container would collapse all decorations to
  // a single depth slot, forcing them all above or below every moving entity.

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

  // Paths painted in the map editor are intentionally NOT drawn. Roads are
  // generated as desire paths from the buildings that actually get spawned
  // (see game/data/desire-paths.ts), and a stale hand-drawn layer underneath
  // would contradict them. The container is still created so the returned
  // shape is unchanged for callers.

  // Decorations — added top-level so Y-sorting works against NPCs/heroes.
  // Depth uses the sprite's *foot* Y (bottom edge), not its center: an NPC
  // walking in front of a tree's trunk (NPC Y > tree foot Y) should cover the
  // tree, while an NPC standing behind it (NPC Y < foot Y) stays hidden.
  const featureBounds: Containers['featureBounds'] = [];
  for (const d of map.decorations) {
    if (!scene.textures.exists(d.textureKey)) continue;
    if (isScatter(d.textureKey)) continue;
    if (insideAny(d.x, d.y, clearZones)) continue;
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

  return { base, terrain, paths, featureBounds };
}
