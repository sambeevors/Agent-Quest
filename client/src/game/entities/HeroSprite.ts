import * as Phaser from 'phaser';
import { HERO_LABEL_COLOR, SOURCE_BADGE_COLOR, type HeroColor, type AgentActivity, type AgentSource, type AgentState } from '../../types/agent';
import type { Trainer } from '../../naming/hero-names';
import { findDetour, findWalk } from '../town/pathfinding';
import { TILE, tileAt, type Point } from '../town/town';
import { YIELD_WAIT_MS, type Traffic } from '../town/traffic';
import { addCrispText, HERO_LABEL_DEPTH, LABEL_FONT } from '../text';
import { ThoughtBubble } from './ThoughtBubble';
import { spawnItemPopup, type PopupContent } from './ItemPopup';
import { spriteAnchors, type SpriteAnchors } from '../data/sprite-anchors';
import { leaderSegment, type LabelBox, type LabelOffset } from '../data/label-declutter';
import { CHATTER_HOLD_MS, nextChatterDelay, pickChatterLine, type ChatterMood } from '../data/hero-chatter';
import {
  BATTLE_FRAME_RATE, BATTLE_FRAMES, BATTLE_LUNGE_PX, battleBeat,
  iconTextureKey, partnerSpec, SPRITE_SCALE, standFrame, TRAINER_EXTENT, trainerTextureKey, walkFrames,
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

interface Partner {
  sprite: Phaser.GameObjects.Sprite;
  spec: PokemonSpec;
  headOffset: number;
  footOffset: number;
}

/** A building a trainer is headed into or is inside: the doorway (the feet of
 * a trainer standing in it) and the tile its partner waits on outside. */
interface Indoors {
  door: Point;
  post: Point;
}

/** Every door in town is entered from the tile right below it. */
function doorstepOf(door: Point): Point {
  return { x: door.x, y: door.y + TILE };
}

function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

const HALO_TEXTURE_KEY = 'hero-selection-halo';

/** How far behind its trainer, along the path walked, a partner trots. */
const PARTNER_FOLLOW_DISTANCE = 30;
/** Where a partner waits beside a hero that hasn't walked anywhere yet. */
const PARTNER_REST_OFFSET_X = -22;
/** Hop rate of a partner on the move, and of one waiting at heel. */
const PARTNER_MOVING_FPS = 6;
const PARTNER_RESTING_FPS = 2;
/** How far up the bridge from its trainer a battling partner stands — most
 * of a tile, so it fights in the gap rather than at heel. Straight ahead, not
 * towards the foe: trainers stand one to a tile, so their partners do too,
 * where aiming at a shared foe would pile them on top of each other. */
const PARTNER_BATTLE_DISTANCE = 28;
/** The flash a struck Pokémon shows — the bake's hit-flash colour. */
const HIT_FLASH_COLOR = 0xf8f8f8;
/** Gap between popups queued together, so a +1 and a level-up don't stack. */
const POPUP_STAGGER_MS = 450;
/** Clear air between the top of the label stack and a popup. */
const POPUP_GAP = 4;
/** An evolution: the partner flickers white this many times, changing at the midpoint. */
const EVOLVE_FLICKERS = 10;
const EVOLVE_FLICKER_MS = 110;
/** A change of task: FireRed's red `!`, the one a trainer flashes on
 * spotting you, pops up over the label stack and holds a beat. */
const ALERT_HOLD_MS = 1100;
const ALERT_GAP = 2;
/** It jumps this far up into place as it appears. */
const ALERT_HOP_PX = 6;
const ALERT_HOP_MS = 160;

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
  /** Who stands where, shared by every trainer in town — see traffic.ts. */
  private traffic: Traffic;
  /** Pending retry of a step someone else is standing in the way of. */
  private yieldTimer: Phaser.Time.TimerEvent | null = null;
  /** Beats spent waiting for the tile ahead; reset by every step taken. */
  private yieldWaits = 0;
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
  private partner: Partner | null = null;
  /** Recent foot positions, newest last — the trail the partner follows. */
  private trail: Point[] = [];
  /** Feet of the Pokémon the partner is battling, or null when it's at heel. */
  private battleFoe: Point | null = null;
  private battleTimer: Phaser.Time.TimerEvent | null = null;
  /** Index into BATTLE_FRAMES. */
  private battleStep = 0;
  /** The building the trainer is going into or is in, or null out of doors. */
  private indoors: Indoors | null = null;
  /** Through the door: the trainer is hidden and its partner waits outside. */
  private inside = false;
  /** The partner walking on its own — to its post, or back to the door. */
  private partnerTween: Phaser.Tweens.Tween | null = null;
  /** The species the partner is drawn as — the trainer's own, or what it has evolved into. */
  private partnerSpecies: number;
  private evolveTimer: Phaser.Time.TimerEvent | null = null;
  /** Popups waiting their turn (or for the trainer to arrive). */
  private popupQueue: PopupContent[] = [];
  private popupTimer: Phaser.Time.TimerEvent | null = null;
  /** Top of the label stack, where popups rise from. */
  private labelTop = 0;
  private labelX = 0;
  /** The `!` shown on a change of task; created on first use. */
  private alert: Phaser.GameObjects.Image | null = null;
  private alertTimer: Phaser.Time.TimerEvent | null = null;
  private alertTween: Phaser.Tweens.Tween | null = null;
  /** How far below its resting place the `!` is, mid-hop. */
  private alertDrop = 0;
  /** False until the scene first says what the hero is doing — spawning isn't a change. */
  private activityKnown = false;

  /** Grid base position — used for slot repositioning. */
  gridBaseX = 0;
  gridBaseY = 0;

  /** `feetX`/`feetY` is where the trainer stands — see town.ts. */
  constructor(
    scene: Phaser.Scene,
    traffic: Traffic,
    id: string,
    name: string,
    trainer: Trainer,
    heroColor: HeroColor,
    feetX: number,
    feetY: number,
    isSubagent = false,
    source: AgentSource = 'claude',
    partnerSpecies: number = trainer.partner,
  ) {
    this.scene = scene;
    this.traffic = traffic;
    this.id = id;
    this.trainer = trainer;
    this.source = source;
    this.isSubagent = isSubagent;
    this.textureKey = trainerTextureKey(trainer);
    this.anchors = spriteAnchors(TRAINER_EXTENT, SPRITE_SCALE);
    this._x = feetX;
    this._y = feetY - this.anchors.footOffset;
    // Trainers arriving together share the spawn until they file out.
    traffic.claim(id, tileAt({ x: feetX, y: feetY }));
    const x = this._x;
    const y = this._y;

    this.sprite = scene.add.sprite(x, y, this.textureKey, standFrame(this.facing));
    this.sprite.setScale(SPRITE_SCALE);
    // Tag at construction time so the scene-level background-click
    // detector (VillageScene) can classify pointerdown hits correctly
    // regardless of which code path later wires up interactivity.
    this.sprite.setData('isHero', true);

    this.partnerSpecies = partnerSpecies;
    this.playStationary();
    this.createPartner(partnerSpec(trainer, partnerSpecies));

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

  /** Whether the hero is walking — a walking hero's labels stay unlifted.
   *  Indoors, its labels ride its partner, so that counts too. */
  get isMoving(): boolean { return this.moving || this.partnerTween !== null; }

  /** The doorway of the building the trainer is inside, or null. */
  get doorway(): Point | null {
    return this.inside ? (this.indoors?.door ?? null) : null;
  }

  /**
   * What the label stack and the halo hang off: the trainer, or — while it
   * is inside a building — the partner it left at the door, so the name says
   * who is in there.
   */
  private labelAnchor(): { x: number; head: number; foot: number } {
    const p = this.partner;
    if (this.inside && p !== null) {
      return { x: p.sprite.x, head: p.sprite.y + p.headOffset, foot: p.sprite.y + p.footOffset };
    }
    return { x: this._x, head: this._y + this.anchors.headOffset, foot: this._y + this.anchors.footOffset };
  }

  /**
   * The label stack's box at rest (no lift), for the scene's declutter pass.
   * Prioritised by foot y, so the hero nearest the viewer keeps its name
   * closest to its head.
   */
  labelBox(): LabelBox {
    const anchor = this.labelAnchor();
    const nameH = this.nameText.displayHeight;
    const badgeH = this.badgeRowHeight();
    const width = Math.max(
      this.nameText.displayWidth,
      badgeH > 0 ? this.badgeRowWidth() : 0,
    );
    return {
      id: this.id,
      x: anchor.x,
      bottom: anchor.head - NAME_HEAD_GAP,
      width,
      height: nameH + (badgeH > 0 ? BADGE_GAP + badgeH : 0),
      priority: anchor.foot,
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
    // The partner answers for its trainer — it is all there is to click
    // while the trainer is indoors.
    if (this.partner !== null) {
      this.partner.sprite.setInteractive({ useHandCursor: true });
      this.partner.sprite.on('pointerdown', onClick);
    }
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
      const halo = this.scene.add.image(0, 0, HALO_TEXTURE_KEY);
      halo.setDisplaySize(diameter, diameter);
      halo.setAlpha(0.35);
      this.selectionHalo = halo;
      this.syncHalo();
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

  /** Record what the hero is doing — it picks the pool its thoughts come from. */
  setActivity(activity: AgentActivity): void {
    if (this.activityKnown && activity !== this.currentActivity) this.flashAlert();
    this.activityKnown = true;
    this.currentActivity = activity;
  }

  /** Pop the `!` over the trainer's head (or its partner's, indoors). */
  private flashAlert(): void {
    if (!this.scene.textures.exists(iconTextureKey('alert'))) return;
    if (this.alert === null) {
      this.alert = this.scene.add.image(0, 0, iconTextureKey('alert'))
        .setOrigin(0.5, 1)
        .setScale(SPRITE_SCALE);
    }
    // Whatever the trainer was thinking was about the task it just left.
    this.bubble.hide();
    this.alertTween?.stop();
    this.alertTimer?.remove();
    this.alert.setVisible(true);
    this.alertDrop = ALERT_HOP_PX;
    this.alertTween = this.scene.tweens.add({
      targets: this,
      alertDrop: 0,
      duration: ALERT_HOP_MS,
      ease: 'Back.easeOut',
      onUpdate: () => this.placeAlert(),
      onComplete: () => { this.alertTween = null; },
    });
    this.alertTimer = this.scene.time.delayedCall(ALERT_HOLD_MS, () => {
      this.alertTimer = null;
      this.alert?.setVisible(false);
    });
    this.placeAlert();
    this.updateDepth();
  }

  private placeAlert(): void {
    this.alert?.setPosition(this.labelX, this.labelTop - ALERT_GAP + this.alertDrop);
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
    }
  }

  /** A parked trainer stands still facing its spot, whatever it is doing —
   * a FireRed character only steps when it moves. */
  private playStationary(): void {
    this.sprite.stop();
    this.sprite.setFrame(standFrame(this.facing));
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
    this.syncHalo();
    // Labels sort in their own band above the world (see HERO_LABEL_DEPTH),
    // keyed by foot y so the near hero's name still covers the far one's.
    const labelDepth = HERO_LABEL_DEPTH + this.labelAnchor().foot / 10000;
    this.nameText.setDepth(labelDepth);
    // Just under every name, so a leader passes behind the text it crosses.
    this.leader.setDepth(HERO_LABEL_DEPTH - 0.5);
    if (this.subagentText !== null) this.subagentText.setDepth(labelDepth);
    if (this.sourceText !== null) this.sourceText.setDepth(labelDepth);
    this.bubble.setDepth(labelDepth + 0.00005);
    this.alert?.setDepth(labelDepth + 0.00006);
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

  /** Centre the halo on whoever the labels hang off, just behind it. */
  private syncHalo(): void {
    if (this.selectionHalo === null) return;
    const a = this.labelAnchor();
    this.selectionHalo.setPosition(a.x, (a.head + a.foot) / 2);
    this.selectionHalo.setDepth(a.foot + 0.4);
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
    const anchor = this.labelAnchor();
    const headY = anchor.head - NAME_HEAD_GAP;
    const nameBottom = headY - this.labelOffset.lift;
    const labelX = anchor.x + this.labelOffset.dx;
    this.nameText.setPosition(labelX, nameBottom);
    this.drawLeader(labelX, nameBottom, anchor.x, headY);
    let top = nameBottom - this.nameText.displayHeight;
    const badgeH = this.badgeRowHeight();
    if (badgeH > 0) {
      this.layoutBadges(labelX, top - BADGE_GAP - badgeH / 2);
      top -= BADGE_GAP + badgeH;
    }
    this.bubble.setPosition(labelX, top - BUBBLE_GAP);
    this.labelX = labelX;
    this.labelTop = top;
    this.placeAlert();
  }

  /**
   * Float a popup off the trainer — an item earned, a level gained. A
   * trainer on the road holds it, as it holds its thoughts: the item belongs
   * to the place it is walking to, and lands when it gets there.
   */
  showPopup(content: PopupContent): void {
    this.popupQueue.push(content);
    this.drainPopups();
  }

  private drainPopups(): void {
    if (this.popupTimer !== null || this.moving) return;
    const next = this.popupQueue.shift();
    if (next === undefined) return;
    spawnItemPopup(this.scene, this.labelX, this.labelTop - POPUP_GAP, next);
    this.popupTimer = this.scene.time.delayedCall(POPUP_STAGGER_MS, () => {
      this.popupTimer = null;
      this.drainPopups();
    });
  }

  /** Draw the partner as `dex` — where it has levelled to, on spawn or after a reload. */
  setPartnerSpecies(dex: number): void {
    if (dex === this.partnerSpecies || this.evolveTimer !== null) return;
    this.partnerSpecies = dex;
    this.swapPartner(dex);
  }

  /**
   * The partner evolves in front of you: it flickers white, changes halfway
   * through, and settles as the new species.
   */
  evolvePartner(dex: number, onDone: () => void): void {
    const p = this.partner;
    if (p === null || dex === this.partnerSpecies) return;
    this.partnerSpecies = dex;
    this.evolveTimer?.remove();
    let flicker = 0;
    this.evolveTimer = this.scene.time.addEvent({
      delay: EVOLVE_FLICKER_MS,
      repeat: EVOLVE_FLICKERS * 2 - 1,
      callback: () => {
        flicker++;
        if (flicker === EVOLVE_FLICKERS) this.swapPartner(dex);
        const lit = flicker % 2 === 1 && flicker < EVOLVE_FLICKERS * 2;
        if (lit) this.partner?.sprite.setTint(HIT_FLASH_COLOR).setTintMode(Phaser.TintModes.FILL);
        else this.partner?.sprite.clearTint();
        if (flicker >= EVOLVE_FLICKERS * 2) {
          this.evolveTimer = null;
          onDone();
        }
      },
    });
  }

  private swapPartner(dex: number): void {
    const p = this.partner;
    const spec = partnerSpec(this.trainer, dex);
    if (p === null || !this.scene.textures.exists(spec.textureKey)) return;
    this.ensureFollowAnim(spec.textureKey);
    p.spec = spec;
    p.sprite.setTexture(spec.textureKey, 0);
    if (this.battleFoe === null) {
      p.sprite.play(`${spec.textureKey}-follow`);
      p.sprite.anims.timeScale = this.moving ? 1 : PARTNER_RESTING_FPS / PARTNER_MOVING_FPS;
    }
  }

  /**
   * A crowd's names spread out to stay legible, which leaves some of them
   * off to the side of, or a row above, the hero they belong to. The leader
   * settles whose is whose: a thin line from the name down to its own hero's
   * hair, drawn only where the name no longer sits over it.
   */
  private drawLeader(labelX: number, nameBottom: number, headX: number, headY: number): void {
    this.leader.clear();
    if (this.labelOffset.dx === 0 && this.labelOffset.lift === 0) return;
    // The name box carries ~3px of descender room below the letters.
    const seg = leaderSegment(labelX, this.nameText.displayWidth, nameBottom - 3, headX, headY);
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

  private ensureFollowAnim(textureKey: string): void {
    const animKey = `${textureKey}-follow`;
    if (this.scene.anims.exists(animKey)) return;
    this.scene.anims.create({
      key: animKey,
      frames: this.scene.anims.generateFrameNumbers(textureKey, { frames: [0, 1] }),
      frameRate: PARTNER_MOVING_FPS,
      repeat: -1,
    });
  }

  private createPartner(spec: PokemonSpec): void {
    if (!this.scene.textures.exists(spec.textureKey)) {
      // A species the bake didn't ship falls back to the trainer's own.
      spec = partnerSpec(this.trainer);
      if (!this.scene.textures.exists(spec.textureKey)) return;
    }
    const animKey = `${spec.textureKey}-follow`;
    this.ensureFollowAnim(spec.textureKey);
    const scale = this.sprite.scaleY * spec.scale;
    const sprite = this.scene.add.sprite(this._x, this._y, spec.textureKey);
    sprite.setScale(scale);
    sprite.play(animKey);
    sprite.anims.timeScale = PARTNER_RESTING_FPS / PARTNER_MOVING_FPS;
    this.partner = { sprite, spec, ...spriteAnchors(spec.extent, scale) };
    this.placePartner();
  }

  /**
   * Send the partner out against the Pokémon standing at `foe`, or call it
   * back to heel with null. Out, it stands on the tile in front of its
   * trainer, turned to the foe, and trades blows on the bridge Pokémon's own beat: lunge, flash as it's
   * struck, fall back, hop. Walking off calls it back on its own.
   */
  setBattling(foe: Point | null): void {
    const p = this.partner;
    if (p === null) return;
    if (foe === null && this.battleFoe === null) return;
    this.battleTimer?.remove();
    this.battleTimer = null;
    if (foe === null) {
      // Leave the trail starting where it fought, so it rejoins its trainer
      // from there instead of jumping back to heel.
      const stance = { x: p.sprite.x, y: p.sprite.y + p.footOffset };
      this.battleFoe = null;
      p.sprite.clearTint();
      p.sprite.play(`${p.spec.textureKey}-follow`);
      this.trail = [stance, this.feet];
      this.placePartner();
      return;
    }
    this.battleFoe = foe;
    this.battleStep = 0;
    p.sprite.stop();
    this.battleTimer = this.scene.time.addEvent({
      delay: 1000 / BATTLE_FRAME_RATE,
      loop: true,
      callback: () => {
        this.battleStep = (this.battleStep + 1) % BATTLE_FRAMES.length;
        this.placePartner();
      },
    });
    this.placePartner();
  }

  /** Stand a battling partner in front of its trainer and play the current beat. */
  private placeBattlingPartner(p: Partner, foe: Point): void {
    const stance = { x: this._x, y: this.feet.y - PARTNER_BATTLE_DISTANCE };
    const dx = foe.x - stance.x;
    const dy = foe.y - stance.y;
    const len = Math.hypot(dx, dy) || 1;
    const beat = battleBeat(BATTLE_FRAMES[this.battleStep]!);
    const lunge = beat.lunge ? BATTLE_LUNGE_PX * p.sprite.scaleX : 0;
    const at = { x: stance.x + (dx / len) * lunge, y: stance.y + (dy / len) * lunge };
    if (Math.abs(dx) > 0.5) p.sprite.setFlipX((dx > 0) === p.spec.facesLeft);
    p.sprite.setFrame(beat.hop ? 1 : 0);
    if (beat.flash) p.sprite.setTint(HIT_FLASH_COLOR).setTintMode(Phaser.TintModes.FILL);
    else p.sprite.clearTint();
    p.sprite.setPosition(at.x, at.y - p.footOffset);
    p.sprite.setDepth(at.y + 0.5);
  }

  /**
   * Put the partner on the hero's trail, PARTNER_FOLLOW_DISTANCE back along
   * the path the hero's feet actually took — so it rounds corners behind its
   * trainer instead of cutting across them.
   */
  private placePartner(): void {
    const p = this.partner;
    if (p === null) return;
    // Indoors, the partner walks on its own (walkPartnerTo).
    if (this.inside) return;
    if (this.battleFoe !== null) {
      this.placeBattlingPartner(p, this.battleFoe);
      return;
    }
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
    const to = { x: feetX, y: feetY };
    this.afterLeaving((door) => {
      this.indoors = null;
      this.walk(this.route(door, to), activity, onArrive);
    });
  }

  /**
   * Go into a building through the doorway at `door`, leaving the partner on
   * `post` outside — from the street, the partner waiting at the door is how
   * you know who is in there. `onArrive` fires on the doorstep, a step before
   * the trainer goes through. One already inside that is only given a new
   * post (the queue outside moved up) stays in, and its partner moves over.
   */
  goInside(door: Point, post: Point, activity: AgentActivity, onArrive: () => void): void {
    if (this.inside && this.indoors !== null && samePoint(this.indoors.door, door)) {
      this.currentActivity = activity;
      this.indoors.post = post;
      this.walkPartnerTo(post, () => this.facePartnerTowards(door));
      onArrive();
      return;
    }
    this.afterLeaving((exited) => {
      const target: Indoors = { door, post };
      this.indoors = target;
      this.walk(this.route(exited, doorstepOf(door)), activity, () => {
        onArrive();
        if (this.indoors !== target) return;
        // The door is open now; one step up and the trainer is through it.
        this.walk([this.bodyAt(door)], activity, () => this.stepInside());
      });
    });
  }

  /** The sprite position that puts the trainer's feet at `feet`. */
  private bodyAt(feet: Point): Point {
    return { x: feet.x, y: feet.y - this.anchors.footOffset };
  }

  /** The walk to `to`, as sprite positions — starting out of `door` if the
   *  trainer has just come out of one, since a doorway isn't walkable ground. */
  private route(door: Point | null, to: Point): Point[] {
    const avoid = this.traffic.obstacles(this.id);
    const feet = door === null
      ? findWalk(this.feet, to, undefined, undefined, avoid)
      : [door, ...findWalk(doorstepOf(door), to, undefined, undefined, avoid)];
    return feet.map((p) => this.bodyAt(p));
  }

  /**
   * Run `go` once the trainer is out of doors. One inside a building first
   * calls its partner back to the doorstep, then reappears in the doorway
   * with the partner at its heels, and `go` gets the doorway to set off
   * from. A newer call while the partner is still on its way replaces `go`.
   */
  private afterLeaving(go: (door: Point | null) => void): void {
    const indoors = this.indoors;
    if (!this.inside || indoors === null) {
      go(null);
      return;
    }
    this.walkPartnerTo(doorstepOf(indoors.door), () => {
      this.inside = false;
      this.sprite.setVisible(true);
      this.traffic.settle(this.id, tileAt(indoors.door));
      const p = this.partner;
      this.trail = p === null ? [] : [{ x: p.sprite.x, y: p.sprite.y + p.footOffset }, indoors.door];
      this.layoutLabels();
      this.updateDepth();
      go(indoors.door);
    });
  }

  /** Through the door: hide the trainer and send its partner to its post. */
  private stepInside(): void {
    const indoors = this.indoors;
    if (indoors === null) return;
    this.inside = true;
    this.sprite.setVisible(false);
    this.traffic.release(this.id);
    this.layoutLabels();
    this.updateDepth();
    this.walkPartnerTo(indoors.post, () => this.facePartnerTowards(indoors.door));
  }

  /**
   * Walk the partner on its own along the streets to `to` — to its post
   * while its trainer is indoors, or back to the doorstep to meet it. The
   * labels ride along. A newer call replaces the walk and its `onDone`.
   */
  private walkPartnerTo(to: Point, onDone: () => void): void {
    this.partnerTween?.stop();
    this.partnerTween = null;
    const p = this.partner;
    if (p === null) {
      onDone();
      return;
    }
    const at = { x: p.sprite.x, y: p.sprite.y + p.footOffset };
    const legs = findWalk(at, to).slice(1);
    const step = (): void => {
      const leg = legs.shift();
      if (leg === undefined) {
        this.partnerTween = null;
        p.sprite.anims.timeScale = PARTNER_RESTING_FPS / PARTNER_MOVING_FPS;
        onDone();
        return;
      }
      if (Math.abs(leg.x - at.x) > 0.5) p.sprite.setFlipX((leg.x > at.x) === p.spec.facesLeft);
      p.sprite.anims.timeScale = 1;
      this.partnerTween = this.scene.tweens.add({
        targets: at,
        x: leg.x,
        y: leg.y,
        duration: (Math.hypot(leg.x - at.x, leg.y - at.y) / MOVE_SPEED) * 1000,
        ease: 'Linear',
        onUpdate: () => {
          p.sprite.setPosition(at.x, at.y - p.footOffset);
          p.sprite.setDepth(at.y + 0.5);
          this.layoutLabels();
          this.updateDepth();
        },
        onComplete: step,
      });
    };
    step();
  }

  /** Turn a waiting partner to the door its trainer went through. */
  private facePartnerTowards(door: Point): void {
    const p = this.partner;
    if (p === null) return;
    const dx = door.x - p.sprite.x;
    if (Math.abs(dx) > 0.5) p.sprite.setFlipX((dx > 0) === p.spec.facesLeft);
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
    this.yieldTimer?.remove();
    this.yieldTimer = null;
    this.yieldWaits = 0;
    this.arrivalCallback = onArrive ?? null;

    // Remove the first point (current position)
    if (path.length > 1) {
      path.shift();
    }

    if (path.length === 0) {
      this.arrive();
      return;
    }

    // Setting off calls the partner back to heel.
    this.setBattling(null);
    this.moving = true;
    this.traffic.setWalking(this.id, true);
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
    this.drainPopups();
  }

  /** Standing on the spot the walk was headed for. */
  private arrive(): void {
    this.moving = false;
    this.traffic.setWalking(this.id, false);
    if (!this.inside) this.traffic.settle(this.id, tileAt(this.feet));
    this.playStationary();
    this.notifyArrival();
  }

  /**
   * Walk `path` (sprite positions) one tile at a time, as FireRed does —
   * each step first claims the tile it lands on, so no two trainers ever
   * walk through each other (see town/traffic.ts).
   */
  private moveAlongPath(path: Point[]): void {
    if (path.length === 0) {
      this.arrive();
      return;
    }

    let next = path[0]!;
    let remaining = path.slice(1);

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

    // A leg down a street is several steps; take the first.
    if (distance > TILE + 0.5) {
      remaining = [next, ...remaining];
      next = { x: this._x + (dx * TILE) / distance, y: this._y + (dy * TILE) / distance };
    }
    const tile = tileAt({ x: next.x, y: next.y + this.anchors.footOffset });
    if (!this.traffic.claim(this.id, tile) && !this.giveWay(tile, [next, ...remaining])) return;
    this.yieldWaits = 0;

    this.playDirectional('walk', walkFrames(this.facing), 4 * (MOVE_SPEED / WALK_PIXELS_PER_CYCLE));
    const stepDistance = Math.hypot(next.x - this._x, next.y - this._y);
    const to = next;

    this.moveTween = this.scene.tweens.add({
      targets: { x: this._x, y: this._y },
      x: to.x,
      y: to.y,
      duration: (stepDistance / MOVE_SPEED) * 1000,
      ease: 'Linear',
      onUpdate: (_tween, target: { x: number; y: number }) => {
        this._x = target.x;
        this._y = target.y;
        this.sprite.setPosition(this._x, this._y);
        this.placePartner();
        this.layoutLabels();
        this.updateDepth();
      },
      onComplete: () => {
        this._x = to.x;
        this._y = to.y;
        this.moveTween = null;
        this.traffic.settle(this.id, tile);
        this.updateDepth();
        this.moveAlongPath(remaining);
      },
    });
  }

  /**
   * Someone is standing on `tile`, the next step of `path`. Go round them,
   * wait a beat for them to move, or — when neither is getting anywhere —
   * step through after all. True means take the step regardless.
   */
  private giveWay(tile: readonly [number, number], path: Point[]): boolean {
    const { action, blocker } = this.traffic.onBlocked(this.id, tile, this.yieldWaits);
    if (action === 'push') return true;
    const last = path[path.length - 1]!;
    const goal = { x: last.x, y: last.y + this.anchors.footOffset };
    const goalTile = tileAt(goal);
    // Someone on the very spot it's headed for can't be gone round — only waited out.
    if (action === 'detour' && (goalTile[0] !== tile[0] || goalTile[1] !== tile[1])) {
      const detour = findDetour(this.feet, goal, this.traffic.obstacles(this.id, blocker));
      if (detour !== null) {
        this.yieldWaits++;
        this.moveAlongPath(detour.slice(1).map((p) => this.bodyAt(p)));
        return false;
      }
    }
    // Stand still, facing the way it wants to go, until the tile clears.
    this.yieldWaits++;
    this.sprite.stop();
    this.sprite.setFrame(standFrame(this.facing));
    this.placePartner();
    this.yieldTimer = this.scene.time.delayedCall(YIELD_WAIT_MS * (0.75 + Math.random() * 0.5), () => {
      this.yieldTimer = null;
      this.moveAlongPath(path);
    });
    return false;
  }

  destroy(): void {
    this.arrivalCallback = null;
    this.yieldTimer?.remove();
    this.yieldTimer = null;
    this.traffic.release(this.id);
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
    this.battleTimer?.remove();
    this.battleTimer = null;
    this.evolveTimer?.remove();
    this.evolveTimer = null;
    this.popupTimer?.remove();
    this.popupTimer = null;
    this.popupQueue = [];
    this.alertTimer?.remove();
    this.alertTimer = null;
    this.alertTween?.stop();
    this.alertTween = null;
    this.alert?.destroy();
    this.partnerTween?.stop();
    this.partnerTween = null;
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
