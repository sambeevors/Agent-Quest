import * as Phaser from 'phaser';
import { HERO_COLOR_SPRITE_BASE, HERO_LABEL_COLOR, SOURCE_BADGE_COLOR, type HeroClass, type HeroColor, type AgentActivity, type AgentSource, type AgentState } from '../../types/agent';
import { getActiveTheme } from '../themes/registry';
import { findRoadPath, type Point } from '../data/road-network';
import { addCrispText, LABEL_FONT } from '../text';
import { ThoughtBubble } from './ThoughtBubble';
import { CHATTER_HOLD_MS, nextChatterDelay, pickChatterLine, type ChatterMood } from '../data/hero-chatter';

const MOVE_SPEED = 150;
/** Ground distance covered by one full run-cycle. Keeps legs synced to travel. */
const RUN_PIXELS_PER_CYCLE = 60;

/**
 * Label offsets are computed per-instance from the sprite's actual
 * displayHeight so they adapt to whatever scale the active theme uses.
 * Only the name (and the subagent / source badges tucked under it) is drawn
 * on the hero — activity, model, file and prompt used to stack below the
 * sprite, four rows deep, and buried the village in log text. That detail
 * lives in the React panels; the canvas says what a hero is thinking instead.
 */

/**
 * A hero speaks again this soon after an error, whatever its chatter timer
 * was going to do. Errors are the one event worth reacting to on sight.
 */
const ERROR_CHATTER_MAX_AGE_MS = 30 * 1000;

const HALO_TEXTURE_KEY = 'hero-selection-halo';

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
  readonly heroClass: HeroClass;
  private scene: Phaser.Scene;
  private sprite: Phaser.GameObjects.Sprite;
  private nameText: Phaser.GameObjects.Text;
  private subagentText: Phaser.GameObjects.Text | null = null;
  private sourceText: Phaser.GameObjects.Text | null = null;
  private source: AgentSource;
  private isSubagent: boolean;
  private sourceBadgeVisible = false;
  private bubble: ThoughtBubble;
  private _x: number;
  private _y: number;
  private moveTween: Phaser.Tweens.Tween | null = null;
  private waitingTween: Phaser.Tweens.Tween | null = null;
  private chatterTimer: Phaser.Time.TimerEvent | null = null;
  private lastChatterLine: string | null = null;
  private lastErrorAt: number | undefined;
  private idleKey: string;
  private runKey: string;
  private facesLeft: boolean;
  private nameOffsetY: number;
  private subagentOffsetY: number;
  private bubbleOffsetY: number;
  currentActivity: AgentActivity = 'idle';
  private isWaiting = false;
  private nameBaseColor = '#DDDDDD';
  private selectionTween: Phaser.Tweens.Tween | null = null;
  private selectionHalo: Phaser.GameObjects.Image | null = null;

  /** Grid base position — used for slot repositioning. */
  gridBaseX = 0;
  gridBaseY = 0;

  constructor(
    scene: Phaser.Scene,
    id: string,
    name: string,
    heroClass: HeroClass,
    heroColor: HeroColor,
    x: number,
    y: number,
    isSubagent = false,
    source: AgentSource = 'claude',
  ) {
    this.scene = scene;
    this.id = id;
    this.heroClass = heroClass;
    this.source = source;
    this.isSubagent = isSubagent;
    this._x = x;
    this._y = y;

    const theme = getActiveTheme();
    // Map the logical hero color to a sprite base the theme actually ships
    // with. Extra palette entries (teal/orange/green) share the sprite of
    // their base color — only the label (name tag) gets the expanded color,
    // the sprite itself is never recolored.
    const spriteBase = HERO_COLOR_SPRITE_BASE[heroColor];
    const cfg = theme.getHeroConfig(spriteBase, heroClass);
    this.idleKey = cfg.idleKey;
    this.runKey = cfg.runKey;
    this.facesLeft = cfg.facesLeft;

    // Create sprite with idle animation
    this.sprite = scene.add.sprite(x, y, this.idleKey);
    this.sprite.setScale(theme.heroScale);
    // Flip sprites that natively face left so they face right by default
    this.sprite.setFlipX(this.facesLeft);
    if (cfg.tint !== null) this.sprite.setTint(cfg.tint);
    // Tag at construction time so the scene-level background-click
    // detector (VillageScene) can classify pointerdown hits correctly
    // regardless of which code path later wires up interactivity.
    this.sprite.setData('isHero', true);

    // Label offsets derived from actual sprite height — scale with theme.
    const halfH = this.sprite.displayHeight / 2;
    this.nameOffsetY = -(halfH + 2);
    // Subagent marker sits ~16px below the name (standard "subtitle" placement,
    // so the name stays the primary anchor for the eye).
    this.subagentOffsetY = this.nameOffsetY + 16;
    // The bubble hangs off the top of the name rather than the sprite, so it
    // clears the label whatever the theme's hero scale is.
    this.bubbleOffsetY = this.nameOffsetY - 12;

    // Create idle animation if it doesn't exist yet
    const idleAnimKey = `${this.idleKey}-anim`;
    if (!scene.anims.exists(idleAnimKey)) {
      const idleFrameSpec = cfg.idleFrameIndices !== undefined
        ? { frames: cfg.idleFrameIndices }
        : { start: 0, end: cfg.idleFrames - 1 };
      scene.anims.create({
        key: idleAnimKey,
        frames: scene.anims.generateFrameNumbers(this.idleKey, idleFrameSpec),
        frameRate: cfg.idleFrames > 1 ? 8 : 1,
        repeat: -1,
      });
    }

    const runAnimKey = `${this.runKey}-anim`;
    if (!scene.anims.exists(runAnimKey)) {
      // Match frame rate to ground speed so legs don't float or drag.
      const runFrameRate = cfg.runFrames * (MOVE_SPEED / RUN_PIXELS_PER_CYCLE);
      const runFrameSpec = cfg.runFrameIndices !== undefined
        ? { frames: cfg.runFrameIndices }
        : { start: 0, end: cfg.runFrames - 1 };
      scene.anims.create({
        key: runAnimKey,
        frames: scene.anims.generateFrameNumbers(this.runKey, runFrameSpec),
        frameRate: runFrameRate,
        repeat: -1,
      });
    }

    this.sprite.play(idleAnimKey);

    const nameColor = HERO_LABEL_COLOR[heroColor] ?? '#DDDDDD';
    this.nameBaseColor = nameColor;
    this.nameText = addCrispText(scene, x, y + this.nameOffsetY, name, {
      fontSize: '16px',
      color: nameColor,
      fontFamily: LABEL_FONT,
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5);

    // Subagent marker: only created for spawned subagents — sits just above
    // the name to visually distinguish child heroes from parent sessions.
    if (isSubagent) {
      this.subagentText = addCrispText(scene, x, y + this.subagentOffsetY, 'subagent', {
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

    this.bubble = new ThoughtBubble(scene, x, y + this.bubbleOffsetY);
    this.scheduleChatter();

    // Set initial Y-based depth
    this.updateDepth();
  }

  get x(): number { return this._x; }
  get y(): number { return this._y; }

  /** Override the default hero scale (e.g. from MapConfig settings). */
  setHeroScale(scale: number): void {
    this.sprite.setScale(scale);
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
      const diameter = Math.max(this.sprite.displayWidth, this.sprite.displayHeight) * 1.1;
      const halo = this.scene.add.image(this._x, this._y, HALO_TEXTURE_KEY);
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

  /** Record what the hero is doing — it picks the pool its thoughts come from. */
  setActivity(activity: AgentActivity): void {
    this.currentActivity = activity;
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
      this.speak(this.chatterMood());
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
    const footY = this._y + this.sprite.displayHeight * 0.5;
    this.sprite.setDepth(footY + 0.5);
    this.nameText.setDepth(footY + 0.6);
    if (this.subagentText !== null) this.subagentText.setDepth(footY + 0.6);
    if (this.sourceText !== null) this.sourceText.setDepth(footY + 0.6);
    this.bubble.setDepth(footY + 0.7);
    if (this.selectionHalo !== null) this.selectionHalo.setDepth(footY + 0.4);
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
        this._y + this.subagentOffsetY,
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
    this.layoutSubagentAndSource();
    // A hero parked at its building has no active move tween, so the text
    // would keep its default depth (0) and render behind buildings until the
    // next move. Force a depth sweep so the new badge is visible immediately.
    if (justCreated) this.updateDepth();
  }

  /**
   * Position the subagent marker and source badge on the shared subagent row.
   * When both are visible they sit side-by-side (centered as a pair); when
   * only one is visible it sits centered on its own.
   */
  private layoutSubagentAndSource(): void {
    const y = this._y + this.subagentOffsetY;
    if (this.sourceBadgeVisible && this.isSubagent && this.subagentText !== null && this.sourceText !== null) {
      this.subagentText.setOrigin(1, 0.5);
      this.subagentText.setPosition(this._x - 3, y);
      this.sourceText.setOrigin(0, 0.5);
      this.sourceText.setPosition(this._x + 3, y);
      return;
    }
    if (this.subagentText !== null) {
      this.subagentText.setOrigin(0.5);
      this.subagentText.setPosition(this._x, y);
    }
    if (this.sourceText !== null) {
      this.sourceText.setOrigin(0.5);
      this.sourceText.setPosition(this._x, y);
    }
  }

  moveTo(targetX: number, targetY: number, activity: AgentActivity): void {
    this.currentActivity = activity;

    // Cancel existing move
    if (this.moveTween !== null) {
      this.moveTween.stop();
      this.moveTween = null;
    }

    const path = findRoadPath({ x: this._x, y: this._y }, { x: targetX, y: targetY });

    // Remove the first point (current position)
    if (path.length > 1) {
      path.shift();
    }

    if (path.length === 0) {
      this.sprite.play(`${this.idleKey}-anim`, true);
      return;
    }

    this.moveAlongPath(path);
  }

  private moveAlongPath(path: Point[]): void {
    if (path.length === 0) {
      this.sprite.play(`${this.idleKey}-anim`, true);
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

    // Flip based on horizontal direction (invert for sprites that natively face left)
    if (Math.abs(dx) > 5) {
      this.sprite.setFlipX((dx < 0) !== this.facesLeft);
    }

    this.sprite.play(`${this.runKey}-anim`, true);

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
        this.nameText.setPosition(this._x, this._y + this.nameOffsetY);
        this.layoutSubagentAndSource();
        this.bubble.setPosition(this._x, this._y + this.bubbleOffsetY);
        if (this.selectionHalo !== null) {
          this.selectionHalo.setPosition(this._x, this._y);
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
    this.nameText.destroy();
    if (this.subagentText !== null) this.subagentText.destroy();
    if (this.sourceText !== null) this.sourceText.destroy();
    this.bubble.destroy();
  }
}
