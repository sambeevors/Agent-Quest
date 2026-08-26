import * as Phaser from 'phaser';
import type { ArenaNpcSpec } from '../themes/types';

/**
 * The arena's resident cast: the goblin and skeleton a stationed hero spars
 * with. They stand on the east side of the yard facing the heroes' side, and
 * are furniture in the same sense as the forge's anvil — always present, so
 * the arena reads as an arena even when empty.
 *
 * What makes them MEANINGFUL ambience (see CLAUDE.md) is their animation:
 * they idle while the yard is empty and fight only while at least one hero
 * is stationed inside — the same real-state contract as chimney smoke. They
 * carry no session-derived detail beyond that single occupied bit.
 */

/** Where each fighter stands, as fractions of the interior rect. */
const NPC_SPOTS: ReadonlyArray<{ fx: number; fy: number }> = [
  { fx: 0.72, fy: 0.35 },
  { fx: 0.88, fy: 0.8 },
];

export class ArenaFighters {
  private readonly scene: Phaser.Scene;
  private readonly sprites: Array<{ sprite: Phaser.GameObjects.Sprite; spec: ArenaNpcSpec }> = [];
  private fighting = false;

  constructor(
    scene: Phaser.Scene,
    npcs: readonly ArenaNpcSpec[],
    interior: { x: number; y: number; w: number; h: number },
    heroScale: number,
  ) {
    this.scene = scene;
    npcs.forEach((spec, i) => {
      if (!scene.textures.exists(spec.textureKey)) return;
      const spot = NPC_SPOTS[i % NPC_SPOTS.length]!;
      const x = interior.x + interior.w * spot.fx;
      const y = interior.y + interior.h * spot.fy;
      const sprite = scene.add.sprite(x, y, spec.textureKey);
      sprite.setScale(heroScale);
      // Face the heroes' (west) side of the yard.
      sprite.setFlipX(!spec.facesLeft);
      // Same foot-anchored depth rule as HeroSprite, so a hero can pass in
      // front of or behind a fighter correctly.
      sprite.setDepth(y + sprite.displayHeight * 0.5 + 0.5);
      this.ensureAnim(spec, 'idle');
      sprite.play(this.animKey(spec, 'idle'));
      this.sprites.push({ sprite, spec });
    });
  }

  /** Switch the cast between idling and sparring. Idempotent. */
  setFighting(fighting: boolean): void {
    if (fighting === this.fighting) return;
    this.fighting = fighting;
    const state = fighting ? 'attack' : 'idle';
    for (const { sprite, spec } of this.sprites) {
      this.ensureAnim(spec, state);
      sprite.play(this.animKey(spec, state), true);
    }
  }

  private animKey(spec: ArenaNpcSpec, state: 'idle' | 'attack'): string {
    return `arena-${spec.textureKey}-${state}`;
  }

  private ensureAnim(spec: ArenaNpcSpec, state: 'idle' | 'attack'): void {
    const key = this.animKey(spec, state);
    if (this.scene.anims.exists(key)) return;
    const clip = spec[state];
    this.scene.anims.create({
      key,
      frames: this.scene.anims.generateFrameNumbers(spec.textureKey, { frames: clip.frameIndices }),
      frameRate: clip.frameRate,
      repeat: -1,
    });
  }

  destroy(): void {
    for (const { sprite } of this.sprites) sprite.destroy();
    this.sprites.length = 0;
  }
}
