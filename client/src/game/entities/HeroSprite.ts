import * as Phaser from 'phaser';
import { HERO_LABEL_COLOR, SOURCE_BADGE_COLOR, type HeroColor, type AgentActivity, type AgentSource, type AgentState } from '../../types/agent';
import type { Trainer } from '../../naming/hero-names';
import { findWalk } from '../town/pathfinding';
import type { Point } from '../town/town';
import { addCrispText, HERO_LABEL_DEPTH, LABEL_FONT } from '../text';
import { ThoughtBubble } from './ThoughtBubble';
import { spriteAnchors, type SpriteAnchors } from '../data/sprite-anchors';
import { leaderSegment, type LabelBox, type LabelOffset } from '../data/label-declutter';
import { CHATTER_HOLD_MS, nextChatterDelay, pickChatterLine, type ChatterMood } from '../data/hero-chatter';
import {
  BUSY_FRAME_RATE, BUSY_STATES, partnerSpec, SPRITE_SCALE, standFrame, TRAINER_EXTENT, trainerTextureKey, walkFrames,
  type Facing, type PokemonSpec,
} from '../pokemon';

/** World px per second: four tiles a second, a shade quicker than FireRed's
 * walk so a cross-town trip doesn't keep the panels waiting. */
const MOVE_SPEED = 128;
/** One four-beat walk cycle covers two tiles, as in the game. */
const WALK_PIXELS_PER_CYCLE = 64;

/**
 * The label stack hangs off the character's HEAD, as measured by the bake
 * (`TRAINER_EXTENT`). Bottom to top the stack is name, then the subagent /
 * source badge row, then the thought bubble.
 *
 * Only the name (and those badges) is drawn on the hero — activity, model,
 * file and prompt used to stack below the sprite, four rows deep, and buried
 * the village in log text. That detail lives in the React panels; the canvas
 * says what a hero is thinking instead.
 */

/** Clear air between the top of the hair and the bottom of the name's box
 *  (the box already carries a few px of descender room). */
const NAME_HEAD_GAP = 0;
/** Clear air between the name and the badge row above it. */
const BADGE_GAP = 1;
/** Clear air between the top label and the bubble's tail. */
const BUBBLE_GAP = 2;
/** Leader line from a displaced name back to its hero (see leaderSegment). */
const LEADER_COLOR = 0xf4ead2;
const LEADER_OUTLINE = 0x000000;
const LEADER_WIDTH = 1.5;
const LEADER_OUTLINE_WIDTH = 3.5;
const LEADER_ALPHA = 0.85;
/** Selection halo diameter, as a multiple of the character's height. */
const HALO_BODY_FACTOR = 2.2;

/**
 * A hero speaks again this soon after an error, whatever its chatter timer
 * was going to do. Errors are the one event worth reacting to on sight.
 */
const ERROR_CHATTER_MAX_AGE_MS = 30 * 1000;

const HALO_TEXTURE_KEY = 'hero-selection-halo';

/** How far behind its trainer, along the path walked, a partner trots. */
const PARTNER_FOLLOW_DISTANCE = 30;
/** Where a partner waits beside a hero that hasn't walked anywhere yet. */
const PARTNER_REST_OFFSET_X = -22;
/** Hop rate of a partner on the move, and of one waiting at heel. */
const PARTNER_MOVING_FPS = 6;
const PARTNER_RESTING_FPS = 2;

/**
 * Lazily build a soft radial-gradient texture we can reuse as the selection
 * halo. Cached in Phaser's global TextureManager for the lifetime of the
 * game — scenes share it via the same key. The gradient fades white →
 * transparent so the glow blends with the scene instead of looking like a
 * flat disc.
 */
function ensureHaloTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(HALO_TEXTURE_KEY)) return;
  const size = 128;
  const tex = scene.textures.createCanvas(HALO_TEXTURE_KEY, size, size);
  if (tex === null) return;
  const ctx = tex.getContext();
  const cx = size / 2;
  const cy = size / 2;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cx);
  grad.addColorStop(0.00, 'rgba(255, 255, 255, 0.9)');
  grad.addColorStop(0.35, 'rgba(255, 255, 255, 0.45)');
  grad.addColorStop(0.70, 'rgba(255, 255, 255, 0.12)');
  grad.addColorStop(1.00, 'rgba(255, 255, 255, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  tex.refresh();
}

export class HeroSprite {
  readonly id: string;
  readonly trainer: Trainer;
  private scene: Phaser.Scene;
  private sprite: Phaser.GameObjects.Sprite;
  private nameText: Phaser.GameObjects.Text;
  private subagentText: Phaser.GameObjects.Text | null = null;
  /** Thin line from a displaced name to the head it belongs to. */
  private leader: Phaser.GameObjects.Graphics;
  private sourceText: Phaser.GameObjects.Text | null = null;
  private source: AgentSource;
  private isSubagent: boolean;
  private sourceBadgeVisible = false;
  private bubble: ThoughtBubble;
  private _x: number;
  private _y: number;
  private moveTween: Phaser.Tweens.Tween | null = null;
  /** Fired once the current walk reaches its destination; a new moveTo drops it. */
  private arrivalCallback: (() => void) | null = null;
  private waitingTween: Phaser.Tweens.Tween | null = null;
  private chatterTimer: Phaser.Time.TimerEvent | null = null;
  /** A thought the timer raised while the hero was walking — said on arrival. */
  private chatterPending = false;
  private lastChatterLine: string | null = null;
  private lastErrorAt: number | undefined;
  /** The trainer's walker sheet. */
  private textureKey: string;
  private moving = false;
  /** Head and feet relative to the sprite centre, at the current scale. */
  private anchors: SpriteAnchors;
  /** Where the label stack is moved to clear its neighbours' (see label-declutter). */
  private labelOffset: LabelOffset = { dx: 0, lift: 0 };
  currentActivity: AgentActivity = 'idle';
  private isWaiting = false;
  private nameBaseColor = '#DDDDDD';
  private selectionTween: Phaser.Tweens.Tween | null = null;
  private selectionHalo: Phaser.GameObjects.Image | null = null;
  /** Which way the trainer is looking — kept while parked. */
  private facing: Facing = 'down';
  /** The partner Pokémon at the trainer's heels. */
  private partner: { sprite: Phaser.GameObjects.Sprite; spec: PokemonSpec; footOffset: number } | null = null;
  /** Recent foot positions, newest last — the trail the partner follows. */
  private trail: Point[] = [];

  /** Grid base position — used for slot repositioning. */
  gridBaseX = 0;
  gridBaseY = 0;

  /** `feetX`/`feetY` is where the trainer stands — see town.ts. */
  constructor(
    scene: Phaser.Scene,
    id: string,
    name: string,
    trainer: Trainer,
    heroColor: HeroColor,
    feetX: number,
    feetY: number,
    isSubagent = false,
    source: AgentSource = 'claude',
  ) {
    this.scene = scene;
    this.id = id;
    this.trainer = trainer;
    this.source = source;
    this.isSubagent = isSubagent;
    this.textureKey = trainerTextureKey(trainer);
    this.anchors = spriteAnchors(TRAINER_EXTENT, SPRITE_SCALE);
    this._x = feetX;
    this._y = feetY - this.anchors.footOffset;
    const x = this._x;
    const y = this._y;

    this.sprite = scene.add.sprite(x, y, this.textureKey, standFrame(this.facing));
    this.sprite.setScale(SPRITE_SCALE);
    // Tag at construction time so the scene-level background-click
    // detector (VillageScene) can classify pointerdown hits correctly
    // regardless of which code path later wires up interactivity.
    this.sprite.setData('isHero', true);

    this.playStationary();
    this.createPartner(partnerSpec(trainer));

    const nameColor = HERO_LABEL_COLOR[heroColor] ?? '#DDDDDD';
    this.nameBaseColor = nameColor;
    this.nameText = addCrispText(scene, x, y, name, {
      fontSize: '16px',
      color: nameColor,
      fontFamily: LABEL_FONT,
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5, 1);

    // Subagent marker: only created for spawned subagents — sits just above
    // the name to visually distinguish child heroes from parent sessions.
    // (Below the name would be on the hero's face.)
    if (isSubagent) {
      this.subagentText = addCrispText(scene, x, y, 'subagent', {
        fontSize: '10px',
        color: '#9AA4B0',
        fontFamily: LABEL_FONT,
        fontStyle: 'italic',
        stroke: '#000000',
        strokeThickness: 2,
      }).setOrigin(0.5);
    }

    // Source badge is created lazily by setSourceBadgeVisible(true) — shown
    // only when the UI is in mixed-provider mode.

    this.leader = scene.add.graphics();
    this.bubble = new ThoughtBubble(scene, x, y);
    this.layoutLabels();
    this.scheduleChatter();

    // Set initial Y-based depth
    this.updateDepth();
  }

  get x(): number { return this._x; }
  get y(): number { return this._y; }

  /** Whether the hero is walking — a walking hero's labels stay unlifted. */
  get isMoving(): boolean { return this.moving; }

  /**
   * The label stack's box at rest (no lift), for the scene's declutter pass.
   * Prioritised by foot y, so the hero nearest the viewer keeps its name
   * closest to its head.
   */
  labelBox(): LabelBox {
    const nameH = this.nameText.displayHeight;
    const badgeH = this.badgeRowHeight();
    const width = Math.max(
      this.nameText.displayWidth,
      badgeH > 0 ? this.badgeRowWidth() : 0,
    );
    return {
      id: this.id,
      x: this._x,
      bottom: this._y + this.anchors.headOffset - NAME_HEAD_GAP,
      width,
      height: nameH + (badgeH > 0 ? BADGE_GAP + badgeH : 0),
      priority: this._y + this.anchors.footOffset,
    };
  }

  /** Move the label stack off its rest spot ({0, 0} = right above the head). */
  setLabelOffset(offset: LabelOffset): void {
    if (Math.abs(offset.dx - this.labelOffset.dx) < 0.5 && Math.abs(offset.lift - this.labelOffset.lift) < 0.5) return;
    this.labelOffset = { dx: offset.dx, lift: offset.lift };
    this.layoutLabels();
  }

  /** Make the sprite respond to pointerdown with the supplied callback. */
  setInteractiveForSelection(onClick: () => void): void {
    if (!this.sprite.input || !this.sprite.input.enabled) {
      this.sprite.setInteractive({ useHandCursor: true });
    }
    // The `isHero` tag is set in the constructor so it's present even for
    // spawn paths that never call this method.
    this.sprite.on('pointerdown', onClick);
  }

  /**
   * Apply or clear a selection visual: a pulsing blue halo BEHIND the sprite
   * (alpha + scale yoyo ~1s cycle). The sprite itself stays untinted so the
   * character's natural colors are preserved; only the surrounding light
   * pulses. The name text is brightened so the selected hero's label stands
   * out against its neighbors.
   */
  setSelected(selected: boolean): void {
    if (this.selectionTween !== null) {
      this.selectionTween.stop();
      this.selectionTween = null;
    }
    if (this.selectionHalo !== null) {
      this.selectionHalo.destroy();
      this.selectionHalo = null;
    }
    if (selected) {
      ensureHaloTexture(this.scene);
      // Sized and centred on the character, not the frame — the frame is
      // several times larger than the figure, and a frame-sized glow lit up
      // half the neighbouring crowd.
      const bodyH = this.anchors.footOffset - this.anchors.headOffset;
      const diameter = bodyH * HALO_BODY_FACTOR;
      const halo = this.scene.add.image(this._x, this.bodyCentreY(), HALO_TEXTURE_KEY);
      halo.setDisplaySize(diameter, diameter);
      halo.setAlpha(0.35);
      halo.setDepth(this.sprite.depth - 0.1);
      this.selectionHalo = halo;
      // Capture the baseline scale AFTER setDisplaySize so the tween
      // yoyos between this fixed baseline and baseline × peak factor.
      // Using halo.scaleX directly in the tween target would be the
      // same math but reads as if the scale were self-referential.
      const baseScale = halo.scaleX;
      this.selectionTween = this.scene.tweens.add({
        targets: halo,
        alpha: 0.75,
        scaleX: baseScale * 1.25,
        scaleY: baseScale * 1.25,
        duration: 650,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      this.nameText.setColor('#FFFFFF');
      this.nameText.setStroke('#1E5FA3', 5);
    } else {
      this.nameText.setColor(this.nameBaseColor);
      this.nameText.setStroke('#000000', 3);
    }
  }

  /** Record what the hero is doing — it picks the pool its thoughts come
   * from and whether a parked trainer is busy or resting. */
  setActivity(activity: AgentActivity): void {
    this.currentActivity = activity;
    if (!this.moving) this.playStationary();
  }

  /** Apply status-driven overlays (e.g. 'waiting' pulses the name). */
  setStatus(status: AgentState['status']): void {
    const wantsWaiting = status === 'waiting';
    if (wantsWaiting && !this.isWaiting) {
      this.isWaiting = true;
      this.startWaitingPulse();
    } else if (!wantsWaiting && this.isWaiting) {
      this.isWaiting = false;
      this.stopWaitingPulse();
    } else {
      return;
    }
    if (!this.moving) this.playStationary();
  }

  /**
   * What a parked trainer does: marks time on the spot while it works (the
   * way an NPC busy at a counter does), stands still while resting — and
   * while waiting, which outranks the activity: a blocked trainer stands and
   * waits whatever it was doing.
   */
  private playStationary(): void {
    const state = this.isWaiting ? 'waiting' : this.currentActivity;
    if (BUSY_STATES.includes(state)) {
      this.playDirectional('busy', walkFrames(this.facing), BUSY_FRAME_RATE);
    } else {
      this.sprite.stop();
      this.sprite.setFrame(standFrame(this.facing));
    }
    this.placePartner();
  }

  /**
   * React to the session's most recent error. Called on every update with the
   * same timestamp, so the bubble fires once per distinct error — and only
   * while it is fresh, or a hero spawning into a minute-old failure would
   * announce it as news.
   */
  setErrorTimestamp(ts: number | undefined): void {
    if (ts === undefined || ts === this.lastErrorAt) return;
    this.lastErrorAt = ts;
    if (Date.now() - ts > ERROR_CHATTER_MAX_AGE_MS) return;
    this.speak('error');
    // Push the periodic thought out, so the reaction isn't stepped on.
    this.scheduleChatter();
  }

  /** What the hero is minded to say right now. */
  private chatterMood(): ChatterMood {
    return this.isWaiting ? 'waiting' : this.currentActivity;
  }

  private speak(mood: ChatterMood): void {
    const line = pickChatterLine(mood, this.lastChatterLine);
    this.lastChatterLine = line;
    this.bubble.say(line, CHATTER_HOLD_MS);
  }

  /** Queue the next idle thought. Each hero re-rolls its own gap, so a party
   * of heroes never falls into step. */
  private scheduleChatter(): void {
    if (this.chatterTimer !== null) this.chatterTimer.remove();
    this.chatterTimer = this.scene.time.delayedCall(nextChatterDelay(), () => {
      this.chatterTimer = null;
      // A hero on the road holds its tongue. The lines speak in the register
      // of the BUILDING the hero is stationed at, and the activity flips at
      // dispatch — so one said mid-walk would ring an anvil the hero is still
      // half a village away from. It lands on arrival instead.
      if (this.moving) {
        this.chatterPending = true;
      } else {
        this.speak(this.chatterMood());
      }
      this.scheduleChatter();
    });
  }

  private startWaitingPulse(): void {
    if (this.waitingTween !== null) return;
    this.waitingTween = this.scene.tweens.add({
      targets: this.nameText,
      alpha: { from: 1, to: 0.45 },
      duration: 700,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
    });
  }

  private stopWaitingPulse(): void {
    if (this.waitingTween !== null) {
      this.waitingTween.stop();
      this.waitingTween = null;
    }
    this.nameText.setAlpha(1);
  }

  /** Update depth of sprite and labels based on Y position (Y-sorting). */
  private updateDepth(): void {
    // Sort by the hero's FEET, not its center, so the pivot matches buildings
    // (bottom-anchored, origin 0.5/1) and decorations that sort on their base.
    // Without this, a hero whose feet align with a building's foot would render
    // behind it because his center-y is well above the building's foot-y.
    const footY = this._y + this.anchors.footOffset;
    this.sprite.setDepth(footY + 0.5);
    if (this.selectionHalo !== null) this.selectionHalo.setDepth(footY + 0.4);
    // Labels sort in their own band above the world (see HERO_LABEL_DEPTH),
    // keyed by foot y so the near hero's name still covers the far one's.
    const labelDepth = HERO_LABEL_DEPTH + footY / 10000;
    this.nameText.setDepth(labelDepth);
    // Just under every name, so a leader passes behind the text it crosses.
    this.leader.setDepth(HERO_LABEL_DEPTH - 0.5);
    if (this.subagentText !== null) this.subagentText.setDepth(labelDepth);
    if (this.sourceText !== null) this.sourceText.setDepth(labelDepth);
    this.bubble.setDepth(labelDepth + 0.00005);
  }

  /**
   * Show or hide the source badge (`CODEX` / `CLAUDE`). Called by the scene
   * whenever the fleet's provider makeup changes. Lazily creates the Text
   * object on first reveal. When a subagent marker is already present, the
   * two labels sit side-by-side on the subagent row; otherwise the badge sits
   * alone on that row.
   */
  setSourceBadgeVisible(visible: boolean): void {
    this.sourceBadgeVisible = visible;
    const justCreated = visible && this.sourceText === null;
    if (justCreated) {
      this.sourceText = addCrispText(
        this.scene,
        this._x,
        this._y,
        this.source.toUpperCase(),
        {
          fontSize: '10px',
          color: SOURCE_BADGE_COLOR[this.source],
          fontFamily: LABEL_FONT,
          stroke: '#000000',
          strokeThickness: 2,
        },
      );
    }
    if (this.sourceText !== null) {
      this.sourceText.setVisible(visible);
    }
    this.layoutLabels();
    // A hero parked at its building has no active move tween, so the text
    // would keep its default depth (0) and render behind buildings until the
    // next move. Force a depth sweep so the new badge is visible immediately.
    if (justCreated) this.updateDepth();
  }

  private bodyCentreY(): number {
    return this._y + (this.anchors.headOffset + this.anchors.footOffset) / 2;
  }

  private badgeRowHeight(): number {
    const sub = this.subagentText?.displayHeight ?? 0;
    const src = this.sourceBadgeVisible ? (this.sourceText?.displayHeight ?? 0) : 0;
    return Math.max(sub, src);
  }

  private badgeRowWidth(): number {
    const sub = this.subagentText?.displayWidth ?? 0;
    const src = this.sourceBadgeVisible ? (this.sourceText?.displayWidth ?? 0) : 0;
    return sub > 0 && src > 0 ? sub + src + 6 : Math.max(sub, src);
  }

  /**
   * Position the whole label stack: the name right above the head (moved by
   * any declutter offset), the badge row above the name, the bubble above
   * both — and, for a displaced name, the leader back down to the head.
   */
  private layoutLabels(): void {
    const headY = this._y + this.anchors.headOffset - NAME_HEAD_GAP;
    const nameBottom = headY - this.labelOffset.lift;
    const labelX = this._x + this.labelOffset.dx;
    this.nameText.setPosition(labelX, nameBottom);
    this.drawLeader(labelX, nameBottom, headY);
    let top = nameBottom - this.nameText.displayHeight;
    const badgeH = this.badgeRowHeight();
    if (badgeH > 0) {
      this.layoutBadges(labelX, top - BADGE_GAP - badgeH / 2);
      top -= BADGE_GAP + badgeH;
    }
    this.bubble.setPosition(labelX, top - BUBBLE_GAP);
  }

  /**
   * A crowd's names spread out to stay legible, which leaves some of them
   * off to the side of, or a row above, the hero they belong to. The leader
   * settles whose is whose: a thin line from the name down to its own hero's
   * hair, drawn only where the name no longer sits over it.
   */
  private drawLeader(labelX: number, nameBottom: number, headY: number): void {
    this.leader.clear();
    if (this.labelOffset.dx === 0 && this.labelOffset.lift === 0) return;
    // The name box carries ~3px of descender room below the letters.
    const seg = leaderSegment(labelX, this.nameText.displayWidth, nameBottom - 3, this._x, headY);
    if (seg === null) return;
    const { x0, y0, x1, y1 } = seg;
    // Pale core in a dark casing, like the names' own stroke, so the line
    // reads over grass, road and roof alike.
    this.leader.lineStyle(LEADER_OUTLINE_WIDTH, LEADER_OUTLINE, LEADER_ALPHA * 0.7);
    this.leader.lineBetween(x0, y0, x1, y1);
    this.leader.lineStyle(LEADER_WIDTH, LEADER_COLOR, LEADER_ALPHA);
    this.leader.lineBetween(x0, y0, x1, y1);
  }

  /**
   * Position the subagent marker and source badge on the shared badge row.
   * When both are visible they sit side-by-side (centered as a pair); when
   * only one is visible it sits centered on its own.
   */
  private layoutBadges(x: number, y: number): void {
    if (this.sourceBadgeVisible && this.isSubagent && this.subagentText !== null && this.sourceText !== null) {
      this.subagentText.setOrigin(1, 0.5);
      this.subagentText.setPosition(x - 3, y);
      this.sourceText.setOrigin(0, 0.5);
      this.sourceText.setPosition(x + 3, y);
      return;
    }
    if (this.subagentText !== null) {
      this.subagentText.setOrigin(0.5);
      this.subagentText.setPosition(x, y);
    }
    if (this.sourceText !== null) {
      this.sourceText.setOrigin(0.5);
      this.sourceText.setPosition(x, y);
    }
  }

  /**
   * Turn a parked trainer to look at a world point — the door it's waiting
   * at, the way a FireRed character faces a counter, or the Pokémon it's
   * battling. Motion overrides it, so this only matters once it has arrived.
   */
  faceTowards(target: Point): void {
    const dx = target.x - this._x;
    const dy = target.y - (this._y + this.anchors.footOffset);
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    this.facing = Math.abs(dx) > Math.abs(dy)
      ? (dx < 0 ? 'left' : 'right')
      : (dy < 0 ? 'up' : 'down');
    if (!this.moving) this.playStationary();
  }

  /** Play a per-direction clip, creating it on first use. */
  private playDirectional(kind: string, frames: number[], frameRate: number): void {
    const key = `${this.textureKey}-${kind}-${this.facing}`;
    if (!this.scene.anims.exists(key)) {
      this.scene.anims.create({
        key,
        frames: this.scene.anims.generateFrameNumbers(this.textureKey, { frames }),
        frameRate,
        repeat: -1,
      });
    }
    this.sprite.play(key, true);
  }

  private createPartner(spec: PokemonSpec): void {
    if (!this.scene.textures.exists(spec.textureKey)) return;
    const animKey = `${spec.textureKey}-follow`;
    if (!this.scene.anims.exists(animKey)) {
      this.scene.anims.create({
        key: animKey,
        frames: this.scene.anims.generateFrameNumbers(spec.textureKey, { frames: [0, 1] }),
        frameRate: PARTNER_MOVING_FPS,
        repeat: -1,
      });
    }
    const scale = this.sprite.scaleY * spec.scale;
    const sprite = this.scene.add.sprite(this._x, this._y, spec.textureKey);
    sprite.setScale(scale);
    sprite.play(animKey);
    sprite.anims.timeScale = PARTNER_RESTING_FPS / PARTNER_MOVING_FPS;
    this.partner = { sprite, spec, footOffset: spriteAnchors(spec.extent, scale).footOffset };
    this.placePartner();
  }

  /**
   * Put the partner on the hero's trail, PARTNER_FOLLOW_DISTANCE back along
   * the path the hero's feet actually took — so it rounds corners behind its
   * trainer instead of cutting across them.
   */
  private placePartner(): void {
    const p = this.partner;
    if (p === null) return;
    const feet = { x: this._x, y: this._y + this.anchors.footOffset };
    const last = this.trail[this.trail.length - 1];
    if (last === undefined || Math.hypot(feet.x - last.x, feet.y - last.y) > 2) this.trail.push(feet);
    let at: Point = this.trail.length > 1 ? this.trail[0]! : { x: feet.x + PARTNER_REST_OFFSET_X, y: feet.y };
    let travelled = 0;
    for (let i = this.trail.length - 1; i > 0; i--) {
      const a = this.trail[i]!;
      const b = this.trail[i - 1]!;
      const seg = Math.hypot(a.x - b.x, a.y - b.y);
      if (travelled + seg >= PARTNER_FOLLOW_DISTANCE) {
        const t = (PARTNER_FOLLOW_DISTANCE - travelled) / seg;
        at = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        this.trail.splice(0, i - 1);
        break;
      }
      travelled += seg;
    }
    const dx = at.x - p.sprite.x;
    if (Math.abs(dx) > 0.5) p.sprite.setFlipX((dx > 0) === p.spec.facesLeft);
    p.sprite.setPosition(at.x, at.y - p.footOffset);
    p.sprite.setDepth(at.y + 0.5);
    p.sprite.anims.timeScale = this.moving ? 1 : PARTNER_RESTING_FPS / PARTNER_MOVING_FPS;
  }

  /**
   * Walk to where the trainer's feet should end up, through the streets of
   * the town (see town/pathfinding.ts). `onArrive` fires when it is actually
   * standing there — immediately if it already is, and never if another
   * moveTo supersedes this one first.
   */
  moveTo(feetX: number, feetY: number, activity: AgentActivity, onArrive?: () => void): void {
    const feet = { x: this._x, y: this._y + this.anchors.footOffset };
    const path = findWalk(feet, { x: feetX, y: feetY })
      .map((p) => ({ x: p.x, y: p.y - this.anchors.footOffset }));
    this.walk(path, activity, onArrive);
  }

  private walk(path: Point[], activity: AgentActivity, onArrive?: () => void): void {
    this.currentActivity = activity;
    // An offset only makes sense among a parked crowd; on the road the name
    // goes back over the head it belongs to. The scene re-spreads it on arrival.
    this.setLabelOffset({ dx: 0, lift: 0 });

    // Cancel existing move
    if (this.moveTween !== null) {
      this.moveTween.stop();
      this.moveTween = null;
    }
    this.arrivalCallback = onArrive ?? null;

    // Remove the first point (current position)
    if (path.length > 1) {
      path.shift();
    }

    if (path.length === 0) {
      this.moving = false;
      this.playStationary();
      this.notifyArrival();
      return;
    }

    this.moving = true;
    this.moveAlongPath(path);
  }

  /** Where the trainer's feet are. */
  get feet(): Point {
    return { x: this._x, y: this._y + this.anchors.footOffset };
  }

  private notifyArrival(): void {
    if (this.chatterPending) {
      this.chatterPending = false;
      // Now in the right building, so the register is finally correct.
      this.speak(this.chatterMood());
      this.scheduleChatter();
    }
    const cb = this.arrivalCallback;
    this.arrivalCallback = null;
    cb?.();
  }

  private moveAlongPath(path: Point[]): void {
    if (path.length === 0) {
      this.moving = false;
      this.playStationary();
      this.notifyArrival();
      return;
    }

    const next = path[0]!;
    const remaining = path.slice(1);

    const dx = next.x - this._x;
    const dy = next.y - this._y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 5) {
      this._x = next.x;
      this._y = next.y;
      this.updateDepth();
      this.moveAlongPath(remaining);
      return;
    }

    // Four-way walkers take the row for the dominant axis of travel.
    this.facing = Math.abs(dx) >= Math.abs(dy)
      ? (dx < 0 ? 'left' : 'right')
      : (dy < 0 ? 'up' : 'down');
    this.playDirectional('walk', walkFrames(this.facing), 4 * (MOVE_SPEED / WALK_PIXELS_PER_CYCLE));

    const duration = (distance / MOVE_SPEED) * 1000;

    this.moveTween = this.scene.tweens.add({
      targets: { x: this._x, y: this._y },
      x: next.x,
      y: next.y,
      duration,
      ease: 'Linear',
      onUpdate: (_tween, target: { x: number; y: number }) => {
        this._x = target.x;
        this._y = target.y;
        this.sprite.setPosition(this._x, this._y);
        this.placePartner();
        this.layoutLabels();
        if (this.selectionHalo !== null) {
          this.selectionHalo.setPosition(this._x, this.bodyCentreY());
        }
        this.updateDepth();
      },
      onComplete: () => {
        this._x = next.x;
        this._y = next.y;
        this.moveTween = null;
        this.updateDepth();
        this.moveAlongPath(remaining);
      },
    });
  }

  destroy(): void {
    this.arrivalCallback = null;
    if (this.moveTween !== null) {
      this.moveTween.stop();
    }
    if (this.waitingTween !== null) {
      this.waitingTween.stop();
      this.waitingTween = null;
    }
    if (this.chatterTimer !== null) {
      this.chatterTimer.remove();
      this.chatterTimer = null;
    }
    if (this.selectionTween !== null) {
      this.selectionTween.stop();
      this.selectionTween = null;
    }
    if (this.selectionHalo !== null) {
      this.selectionHalo.destroy();
      this.selectionHalo = null;
    }
    this.sprite.destroy();
    this.partner?.sprite.destroy();
    this.partner = null;
    this.nameText.destroy();
    this.leader.destroy();
    if (this.subagentText !== null) this.subagentText.destroy();
    if (this.sourceText !== null) this.sourceText.destroy();
    this.bubble.destroy();
  }
}
