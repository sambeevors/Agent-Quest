import * as Phaser from 'phaser';
import { addCrispText, LABEL_FONT } from '../text';

/**
 * The little parchment bubble that pops above a hero's head.
 *
 * Drawn rather than shipped as art: the body has to resize to whatever line
 * it is holding, and a nine-slice PNG at this size would fight the pixel grid
 * every time the camera zooms. Colours are the pack's own parchment and ink
 * so the bubble sits with the buildings rather than on top of them.
 */

const FILL = 0xf6efdc;
const BORDER = 0x2a2018;
const INK = '#2A2018';

/** Wrap width. Two lines at this width clear the sprite; three would not. */
const WRAP_WIDTH = 168;
const PAD_X = 8;
const PAD_Y = 5;
const CORNER = 7;
/** Vertical room between the hero's head and the underside of the body. */
const TAIL_HEIGHT = 16;

const FADE_IN_MS = 220;
const FADE_OUT_MS = 260;

export class ThoughtBubble {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Graphics;
  private text: Phaser.GameObjects.Text;
  private tween: Phaser.Tweens.Tween | null = null;
  private hideTimer: Phaser.Time.TimerEvent | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.scene = scene;
    this.bg = scene.add.graphics();
    this.text = addCrispText(scene, 0, 0, '', {
      fontSize: '13px',
      color: INK,
      fontFamily: LABEL_FONT,
      align: 'center',
      wordWrap: { width: WRAP_WIDTH, useAdvancedWrap: true },
    }).setOrigin(0.5);
    this.container = scene.add.container(x, y, [this.bg, this.text]);
    this.container.setAlpha(0);
    this.container.setVisible(false);
  }

  /** Pop the bubble with `line`, hold it, then fade it away. */
  say(line: string, holdMs: number): void {
    this.text.setText(line);
    this.redraw();

    this.stopAnimation();
    this.container.setVisible(true);
    this.container.setAlpha(0);
    this.container.setScale(0.7);
    this.tween = this.scene.tweens.add({
      targets: this.container,
      alpha: 1,
      scaleX: 1,
      scaleY: 1,
      duration: FADE_IN_MS,
      ease: 'Back.easeOut',
    });
    this.hideTimer = this.scene.time.delayedCall(holdMs, () => {
      this.hideTimer = null;
      this.tween = this.scene.tweens.add({
        targets: this.container,
        alpha: 0,
        duration: FADE_OUT_MS,
        ease: 'Sine.easeIn',
        onComplete: () => {
          this.tween = null;
          this.container.setVisible(false);
        },
      });
    });
  }

  setPosition(x: number, y: number): void {
    this.container.setPosition(x, y);
  }

  setDepth(depth: number): void {
    this.container.setDepth(depth);
  }

  destroy(): void {
    this.stopAnimation();
    this.container.destroy(true);
  }

  private stopAnimation(): void {
    if (this.tween !== null) {
      this.tween.stop();
      this.tween = null;
    }
    if (this.hideTimer !== null) {
      this.hideTimer.remove();
      this.hideTimer = null;
    }
  }

  /**
   * Size the body to the current text and hang it above the container's
   * origin, which is the point the puffs trail down to (the hero's head).
   */
  private redraw(): void {
    const w = this.text.displayWidth + PAD_X * 2;
    const h = this.text.displayHeight + PAD_Y * 2;
    const top = -(TAIL_HEIGHT + h);

    this.text.setPosition(0, top + h / 2);

    this.bg.clear();
    this.bg.fillStyle(FILL, 0.95);
    this.bg.lineStyle(2, BORDER, 1);
    this.bg.fillRoundedRect(-w / 2, top, w, h, CORNER);
    this.bg.strokeRoundedRect(-w / 2, top, w, h, CORNER);
    // Two trailing puffs rather than a speech tail: these are thoughts, and a
    // hero muttering at a building would otherwise read as dialogue.
    this.bg.fillStyle(FILL, 0.95);
    this.bg.fillCircle(-7, -TAIL_HEIGHT + 5, 4);
    this.bg.lineStyle(1.5, BORDER, 1);
    this.bg.strokeCircle(-7, -TAIL_HEIGHT + 5, 4);
    this.bg.fillCircle(-12, -3, 2.5);
    this.bg.strokeCircle(-12, -3, 2.5);
  }
}
