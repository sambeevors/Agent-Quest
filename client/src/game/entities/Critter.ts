import * as Phaser from 'phaser';

/**
 * An ambient animal that actually moves: chickens, pigs, sheep and cows
 * pottering around the meadow, ducks paddling on the lake.
 *
 * A critter has a HOME — the point the seeded scenery generator (or the water
 * placement) chose for it, already validated against buildings, roads and
 * shores — and wanders inside a small circle around it (clipped to an
 * optional bounds rect for ducks, so they never paddle up the beach). It
 * walks a short leg, grazes for a while, repeats. Movement itself is
 * randomised per tick; only the placement needs to be deterministic, the
 * same way chimney smoke animates freely from a fixed anchor.
 *
 * Ambience, not signal: critters are part of the foliage layer (see
 * CLAUDE.md), so they must never carry session-derived state.
 */

const WALK_SPEED = 22; // px/s — a potter, not a march

export interface CritterOptions {
  /** Texture key (e.g. `animal-2`, `duck`). `<key>-anim` must be registered. */
  textureKey: string;
  x: number;
  y: number;
  scale: number;
  /** How far from home a wander leg may end. */
  roamRadius: number;
  /** Optional hard bounds (the duck's water rect, inset from the shore). */
  bounds?: { x: number; y: number; w: number; h: number };
}

export class Critter {
  private readonly scene: Phaser.Scene;
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly homeX: number;
  private readonly homeY: number;
  private readonly roamRadius: number;
  private readonly bounds?: CritterOptions['bounds'];
  private moveTween: Phaser.Tweens.Tween | null = null;
  private restTimer: Phaser.Time.TimerEvent | null = null;
  private destroyed = false;

  constructor(scene: Phaser.Scene, opts: CritterOptions) {
    this.scene = scene;
    this.homeX = opts.x;
    this.homeY = opts.y;
    this.roamRadius = opts.roamRadius;
    this.bounds = opts.bounds;

    this.sprite = scene.add.sprite(opts.x, opts.y, opts.textureKey);
    this.sprite.setOrigin(0.5, 1);
    this.sprite.setScale(opts.scale);
    this.sprite.setDepth(opts.y);
    const animKey = `${opts.textureKey}-anim`;
    const frames = scene.anims.exists(animKey) ? scene.anims.get(animKey).frames.length : 0;
    if (frames > 0) {
      this.sprite.play({
        key: animKey,
        startFrame: Math.abs(Math.round(opts.x * 31 + opts.y * 17)) % frames,
      });
    }
    this.rest();
  }

  private rest(): void {
    if (this.destroyed) return;
    this.restTimer = this.scene.time.delayedCall(
      Phaser.Math.Between(2500, 8000),
      () => this.wander(),
    );
  }

  private wander(): void {
    if (this.destroyed) return;
    const angle = Math.random() * Math.PI * 2;
    const dist = this.roamRadius * (0.35 + Math.random() * 0.65);
    let tx = this.homeX + Math.cos(angle) * dist;
    let ty = this.homeY + Math.sin(angle) * dist * 0.6; // flatten: ground creatures roam an ellipse
    if (this.bounds !== undefined) {
      tx = Phaser.Math.Clamp(tx, this.bounds.x, this.bounds.x + this.bounds.w);
      ty = Phaser.Math.Clamp(ty, this.bounds.y, this.bounds.y + this.bounds.h);
    }
    const dx = tx - this.sprite.x;
    const dy = ty - this.sprite.y;
    const length = Math.hypot(dx, dy);
    if (length < 4) {
      this.rest();
      return;
    }
    // The animal strips all face LEFT natively, so flip when heading right.
    if (Math.abs(dx) > 2) this.sprite.setFlipX(dx > 0);
    this.moveTween = this.scene.tweens.add({
      targets: this.sprite,
      x: tx,
      y: ty,
      duration: (length / WALK_SPEED) * 1000,
      ease: 'Sine.easeInOut',
      onUpdate: () => this.sprite.setDepth(this.sprite.y),
      onComplete: () => {
        this.moveTween = null;
        this.rest();
      },
    });
  }

  destroy(): void {
    this.destroyed = true;
    this.moveTween?.stop();
    this.restTimer?.remove();
    this.sprite.destroy();
  }
}
