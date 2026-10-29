import * as Phaser from 'phaser';
import { addCrispText, HERO_LABEL_DEPTH, LABEL_FONT } from '../text';

/**
 * The "+1" that floats up off a trainer when a station hands it something —
 * an item icon and its count, or a line of text for a level-up. Rises, holds
 * a beat, fades, and destroys itself; nothing keeps a reference to it.
 *
 * It sorts just above the name labels, so a popup over a crowd isn't hidden
 * behind a neighbour's name.
 */

const RISE_PX = 26;
const RISE_MS = 1300;
const FADE_DELAY_MS = 700;
const ICON_GAP = 2;
/** Above every hero label (whose depths run HERO_LABEL_DEPTH + foot/10000). */
const POPUP_DEPTH = HERO_LABEL_DEPTH + 1;

export interface PopupContent {
  /** A loaded texture key for an item icon, or null for text alone. */
  iconKey: string | null;
  text: string;
  color: string;
}

export function spawnItemPopup(scene: Phaser.Scene, x: number, y: number, content: PopupContent): void {
  const text = addCrispText(scene, 0, 0, content.text, {
    fontSize: '16px',
    color: content.color,
    fontFamily: LABEL_FONT,
    stroke: '#000000',
    strokeThickness: 3,
  }).setOrigin(0, 1);
  const parts: Phaser.GameObjects.GameObject[] = [];
  let width = text.displayWidth;
  if (content.iconKey !== null && scene.textures.exists(content.iconKey)) {
    const icon = scene.add.image(0, 0, content.iconKey).setOrigin(0, 1);
    width += icon.displayWidth + ICON_GAP;
    icon.setX(-width / 2);
    text.setX(icon.x + icon.displayWidth + ICON_GAP);
    text.setY(-(icon.displayHeight - text.displayHeight) / 2);
    parts.push(icon);
  } else {
    text.setX(-width / 2);
  }
  parts.push(text);

  const container = scene.add.container(x, y, parts).setDepth(POPUP_DEPTH).setScale(0.6).setAlpha(0);
  scene.tweens.add({ targets: container, scale: 1, alpha: 1, duration: 180, ease: 'Back.easeOut' });
  scene.tweens.add({ targets: container, y: y - RISE_PX, duration: RISE_MS, ease: 'Sine.easeOut' });
  scene.tweens.add({
    targets: container,
    alpha: 0,
    delay: FADE_DELAY_MS,
    duration: RISE_MS - FADE_DELAY_MS,
    ease: 'Sine.easeIn',
    onComplete: () => container.destroy(true),
  });
}
