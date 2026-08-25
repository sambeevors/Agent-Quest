import * as Phaser from 'phaser';
import type { LinearProject } from '../../types/agent';
import { eventBridge } from '../EventBridge';
import { addCrispText } from '../text';

/**
 * A Linear project rendered as a building under construction.
 *
 * The visual is two stacked sprites: scaffolding underneath, the finished
 * house on top, with the finished house CROPPED from the bottom up in
 * proportion to the project's issue completion. As issues close the building
 * literally rises out of its scaffolding, so progress is readable at a glance
 * without reading the label.
 *
 * Both textures already ship with the theme (the decorative-house set the
 * TerrainRenderer scatters around the map), so this adds no new assets.
 */

/** Palette cycled across sites so adjacent projects are distinguishable. */
const SITE_COLORS = ['blue', 'yellow', 'red', 'purple'] as const;

const LABEL_FONT = '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif';

/**
 * Fallback native size of the theme's house sprites. Only used if the texture
 * can't be measured — the real dimensions are read off the loaded frame so a
 * theme shipping differently-sized houses still crops correctly.
 */
const FALLBACK_HOUSE_W = 128;
const FALLBACK_HOUSE_H = 192;

export class ConstructionSite {
  readonly id: string;
  private project: LinearProject;
  private readonly scaffold: Phaser.GameObjects.Image;
  private readonly built: Phaser.GameObjects.Image;
  private readonly nameLabel: Phaser.GameObjects.Text;
  private readonly progressLabel: Phaser.GameObjects.Text;
  private readonly x: number;
  private readonly y: number;
  /** Native frame size of the finished-house texture, for the crop maths. */
  private readonly frameW: number;
  private readonly frameH: number;

  constructor(
    scene: Phaser.Scene,
    project: LinearProject,
    plot: { x: number; y: number },
    colorIndex: number,
    scale = 0.45,
  ) {
    this.id = project.id;
    this.project = project;
    this.x = plot.x;
    this.y = plot.y;

    const color = SITE_COLORS[colorIndex % SITE_COLORS.length]!;

    // `house2` is House_Construction.png in the bundled theme — the scaffolding.
    this.scaffold = scene.add.image(plot.x, plot.y, `house-${color}-house2`);
    this.scaffold.setOrigin(0.5, 1);
    this.scaffold.setScale(scale);
    this.scaffold.setDepth(plot.y);
    this.scaffold.setInteractive({ useHandCursor: true });

    this.built = scene.add.image(plot.x, plot.y, `house-${color}-house1`);
    this.built.setOrigin(0.5, 1);
    this.built.setScale(scale);
    this.built.setDepth(plot.y + 0.05);

    // Measure the actual frame rather than assuming the bundled theme's
    // dimensions — `setCrop` works in texture space, so a wrong height would
    // reveal the wrong slice of the building.
    this.frameW = this.built.frame.realWidth > 0 ? this.built.frame.realWidth : FALLBACK_HOUSE_W;
    this.frameH = this.built.frame.realHeight > 0 ? this.built.frame.realHeight : FALLBACK_HOUSE_H;

    const labelY = plot.y - this.frameH * scale - 8;
    this.nameLabel = addCrispText(scene, plot.x, labelY, truncate(project.name), {
      fontSize: '11px',
      fontStyle: '600',
      color: project.color ?? '#F5E6C8',
      fontFamily: LABEL_FONT,
      stroke: '#000000',
      strokeThickness: 2,
      shadow: { offsetX: 0, offsetY: 1, color: '#000', blur: 3, fill: true },
    }).setOrigin(0.5, 1).setDepth(plot.y + 0.2);

    this.progressLabel = addCrispText(scene, plot.x, labelY + 3, '', {
      fontSize: '10px',
      color: '#d8d8d8',
      fontFamily: LABEL_FONT,
      stroke: '#000000',
      strokeThickness: 1,
      shadow: { offsetX: 0, offsetY: 1, color: '#000', blur: 2, fill: true },
    }).setOrigin(0.5, 0).setDepth(plot.y + 0.2);

    this.scaffold.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      eventBridge.emit('construction:clicked', {
        id: this.id,
        screenX: pointer.x,
        screenY: pointer.y,
      });
    });
    this.scaffold.on('pointerover', () => this.scaffold.setTint(0xdddddd));
    this.scaffold.on('pointerout', () => this.scaffold.clearTint());

    this.applyProgress();
  }

  /** Re-render for an updated project payload (same id). */
  update(project: LinearProject): void {
    const nameChanged = project.name !== this.project.name;
    this.project = project;
    if (nameChanged) this.nameLabel.setText(truncate(project.name));
    this.applyProgress();
  }

  /** World position, for camera panning from the panel. */
  get position(): { x: number; y: number } {
    return { x: this.x, y: this.y };
  }

  /** Where a track meets this site — just outside its front door. */
  get door(): { x: number; y: number } {
    return { x: this.x, y: this.y + 5 };
  }

  /**
   * Ground plan for road routing. Same reasoning as `Building.footprint`:
   * only the lower band of the sprite stands on the ground, so tracks route
   * around that rather than the full image height.
   */
  get footprint(): { x: number; y: number; w: number; h: number } {
    const w = this.scaffold.displayWidth * 0.78;
    const h = Math.max(20, this.scaffold.displayHeight * 0.34);
    return { x: this.x - w / 2, y: this.y - h, w, h };
  }

  destroy(): void {
    this.scaffold.destroy();
    this.built.destroy();
    this.nameLabel.destroy();
    this.progressLabel.destroy();
  }

  /**
   * Reveal the finished house from the ground up. `setCrop` works in TEXTURE
   * space and leaves the visible remainder where it would have been drawn, so
   * cropping away the top yields a building that grows upward from its base.
   */
  private applyProgress(): void {
    const p = Math.min(1, Math.max(0, this.project.progress));
    const visibleH = this.frameH * p;

    if (visibleH <= 0) {
      this.built.setVisible(false);
    } else {
      this.built.setVisible(true);
      // Crop away the TOP `1 - progress` of the frame. Phaser draws the
      // surviving slice where it would have sat in the uncropped sprite, so
      // with a bottom origin the building appears to rise out of the ground.
      this.built.setCrop(0, this.frameH - visibleH, this.frameW, visibleH);
    }
    // A finished project has no scaffolding left to show.
    this.scaffold.setVisible(p < 1);

    const pct = Math.round(p * 100);
    this.progressLabel.setText(
      `${pct}% · ${this.project.completedIssues}/${this.project.totalIssues}`,
    );
  }
}

function truncate(name: string, max = 16): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}
