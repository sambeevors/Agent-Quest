import * as Phaser from 'phaser';
import type { ArenaNpcSpec } from '../pokemon';
import type { Point } from '../town/town';
import { spriteAnchors } from '../data/sprite-anchors';

/**
 * The Pokémon holding the north end of Nugget Bridge — the Rocket's Ekans and
 * Zubat — that trainers running commands battle their way past. They are
 * furniture in the same sense as the Gym or the Mart: always there, so the
 * bridge reads as a place to battle even when nobody is on it.
 *
 * What makes them MEANINGFUL ambience (see CLAUDE.md) is their animation:
 * they idle while the bridge is empty and fight only while at least one
 * trainer has actually walked up and squared off — gated on arrival rather
 * than on the slot assignment, so they aren't lunging at a trainer still
 * crossing town. They carry no session-derived detail beyond that single
 * occupied bit.
 */
export class ArenaFighters {
  private readonly scene: Phaser.Scene;
  private readonly sprites: Array<{ sprite: Phaser.GameObjects.Sprite; spec: ArenaNpcSpec; feet: Point }> = [];
  private fighting = false;

  constructor(
    scene: Phaser.Scene,
    npcs: readonly ArenaNpcSpec[],
    spots: readonly Point[],
    faceX: number,
    heroScale: number,
  ) {
    this.scene = scene;
    npcs.forEach((spec, i) => {
      if (!scene.textures.exists(spec.textureKey)) return;
      const spot = spots[i % spots.length]!;
      const x = spot.x;
      const footY = spot.y;
      const scale = heroScale * spec.scale;
      const { footOffset } = spriteAnchors(spec.extent, scale);
      const sprite = scene.add.sprite(x, footY - footOffset, spec.textureKey);
      sprite.setScale(scale);
      // Party icons face left; turn towards the middle of the bridge.
      sprite.setFlipX(faceX > x);
      // Same foot-anchored depth rule as HeroSprite, so a hero can pass in
      // front of or behind a fighter correctly. The feet are the art's real
      // ground line, not the frame bottom ~20 rows below it.
      sprite.setDepth(footY + 0.5);
      this.ensureAnim(spec, 'idle');
      sprite.play(this.animKey(spec, 'idle'));
      this.sprites.push({ sprite, spec, feet: { x, y: footY } });
    });
  }

  /** The fighter whose feet are closest to `from` — the one a trainer on the
   * bridge and its partner square up to. Null when no fighter's texture
   * loaded. */
  nearest(from: Point): Point | null {
    let best: Point | null = null;
    let bestDist = Infinity;
    for (const { feet } of this.sprites) {
      const d = Math.hypot(feet.x - from.x, feet.y - from.y);
      if (d < bestDist) {
        best = feet;
        bestDist = d;
      }
    }
    return best;
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
