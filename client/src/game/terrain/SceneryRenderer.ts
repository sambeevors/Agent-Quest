import * as Phaser from 'phaser';
import type { SceneryItem } from '../data/scenery';

/**
 * Places generated scenery sprites.
 *
 * Sprites are added top-level rather than into a container so each one's
 * Y-based depth interleaves with heroes and NPCs — a hero walking in front of
 * a tree should cover it, and one standing behind it should be hidden. A
 * container would collapse them all into a single depth slot and force the
 * whole forest either above or below every moving thing.
 *
 * Animated kinds (trees swaying, mushrooms blinking, animals grazing) play
 * the looping animation the theme registered as `<key>-anim`, each starting
 * at a phase derived from its position — deterministic (the same forest
 * animates the same way every reload) but desynchronised, so a stand of
 * trees doesn't sway in lockstep.
 *
 * The returned array is the caller's handle for tearing the scatter down when
 * it needs regenerating.
 */

/** Texture key for an item, e.g. `tree-3`. Must match the theme's registrations. */
function textureKey(item: SceneryItem): string {
  return `${item.kind}-${item.variant}`;
}

export function renderScenery(
  scene: Phaser.Scene,
  items: readonly SceneryItem[],
): Phaser.GameObjects.GameObject[] {
  const sprites: Phaser.GameObjects.GameObject[] = [];

  for (const item of items) {
    const key = textureKey(item);
    if (!scene.textures.exists(key)) continue;

    const animKey = `${key}-anim`;
    const animFrames = scene.anims.exists(animKey) ? scene.anims.get(animKey).frames.length : 0;
    let sprite: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;
    if (animFrames > 0) {
      const s = scene.add.sprite(item.x, item.y, key);
      const phase = Math.abs(Math.round(item.x * 31 + item.y * 17)) % animFrames;
      s.play({ key: animKey, startFrame: phase });
      sprite = s;
    } else {
      sprite = scene.add.image(item.x, item.y, key);
    }
    // Bottom-centre origin: the item's y IS where it meets the ground, which
    // is what both the depth sort and the placement clearances assume.
    sprite.setOrigin(0.5, 1);
    sprite.setScale(item.scale);
    if (item.flipX) sprite.setFlipX(true);
    sprite.setDepth(item.y);
    sprites.push(sprite);
  }

  return sprites;
}
