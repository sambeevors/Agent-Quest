import * as Phaser from 'phaser';
import type { ArenaNpcSpec } from '../themes/types';
import { spriteAnchors } from '../data/sprite-anchors';

/**
 * The arena's resident cast: the goblin and skeleton a stationed hero spars
 * with. They stand on the east side of the yard facing the heroes' side, and
 * are furniture in the same sense as the forge's anvil — always present, so
 * the arena reads as an arena even when empty.
 *
 * What makes them MEANINGFUL ambience (see CLAUDE.md) is their animation:
 * they idle while the yard is empty and fight only while at least one hero
 * has actually walked in and squared up — the same real-state contract as
 * chimney smoke, but gated on arrival rather than on the slot assignment, so
 * they aren't swinging at a hero still crossing the village. They carry no
 * session-derived detail beyond that single occupied bit.
 */

/** Where each fighter's FEET stand, as fractions of the interior rect. */
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
      const footY = interior.y + interior.h * spot.fy;
      const scale = heroScale * (spec.scale ?? 1);
      const { footOffset } = spriteAnchors(spec.extent, scale);
      const sprite = scene.add.sprite(x, footY - footOffset, spec.textureKey);
      sprite.setScale(scale);
      // Face the heroes' (west) side of the yard.
      sprite.setFlipX(!spec.facesLeft);
      // Same foot-anchored depth rule as HeroSprite, so a hero can pass in
      // front of or behind a fighter correctly. The feet are the art's real
      // ground line, not the frame bottom ~20 rows below it.
      sprite.setDepth(footY + 0.5);
      this.ensureAnim(spec, 'idle');
      sprite.play(this.animKey(spec, 'idle'));
      this.sprites.push({ sprite, spec });
    });
  }

  /**
   * World x the cast occupies (mean of the standing spots), so a hero parked
   * in the yard can turn to face them rather than assume a side. Null when
   * the theme ships no fighters.
   */
  focusX(): number | null {
    if (this.sprites.length === 0) return null;
    const sum = this.sprites.reduce((acc, { sprite }) => acc + sprite.x, 0);
    return sum / this.sprites.length;
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
