import * as Phaser from 'phaser';
import type { PathTilemap } from '../data/path-tiles';

/**
 * Draws a tiled road network.
 *
 * Everything is placed into one container at a single depth: roads are ground,
 * so nothing in the world ever needs to sort between two of their tiles. That
 * also makes a rebuild — when the Linear hamlet gains or loses a site — a
 * matter of destroying one object.
 *
 * Tiles are drawn at `cell / tileSize` scale rather than at their native size.
 * The source tiles are 64px, which would make even a footpath as wide as the
 * Library; at half that, a quiet track is one cell across and a well-walked
 * one is three, which is the proportion the buildings are drawn to.
 */
export function renderPathTiles(
  scene: Phaser.Scene,
  map: PathTilemap,
  tilesetKey: string,
  tileSize: number,
  depth = -400,
): Phaser.GameObjects.Container {
  const container = scene.add.container(0, 0).setDepth(depth);
  if (!scene.textures.exists(tilesetKey)) return container;

  const scale = map.cell / tileSize;

  for (const tile of map.tiles) {
    const image = scene.add.image(tile.col * map.cell, tile.row * map.cell, tilesetKey, tile.frame);
    image.setOrigin(0, 0);
    image.setScale(scale);
    container.add(image);
  }

  // Accents last so gravel and tufts sit over the surface rather than under
  // the next tile drawn.
  for (const accent of map.accents) {
    const image = scene.add.image(accent.x, accent.y, tilesetKey, accent.frame);
    image.setOrigin(0.5, 0.5);
    image.setScale(scale);
    if (accent.flipX) image.setFlipX(true);
    container.add(image);
  }

  return container;
}
