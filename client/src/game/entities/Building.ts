import * as Phaser from 'phaser';
import type { BuildingDef } from '../data/building-layout';
import { eventBridge } from '../EventBridge';
import { addCrispText, LABEL_FONT } from '../text';
import { getActiveTheme } from '../themes/registry';

export class Building {
  readonly def: BuildingDef;
  readonly image: Phaser.GameObjects.Image;
  readonly label: Phaser.GameObjects.Text;
  readonly doorX: number;
  readonly doorY: number;
  private readonly scene: Phaser.Scene;
  private smoke: Phaser.GameObjects.Sprite | null = null;
  /** Interior rect in image pixels — set for enclosures heroes walk into. */
  private readonly interior: readonly [number, number, number, number] | null;
  private ground: Phaser.GameObjects.Image | null = null;

  constructor(scene: Phaser.Scene, def: BuildingDef) {
    this.def = def;
    this.scene = scene;

    this.interior = getActiveTheme().getBuildingInterior?.(def.id) ?? null;

    // An enclosure's floor (arena earth, farm soil) is a separate layer under
    // everything y-sorted: baked into the main image it would sit at door
    // depth and paint over any hero standing inside the fence.
    if (this.interior !== null && scene.textures.exists(`${def.imageKey}-ground`)) {
      this.ground = scene.add.image(def.x, def.y, `${def.imageKey}-ground`);
      this.ground.setOrigin(0.5, 1);
      this.ground.setScale(getActiveTheme().getBuildingScale(def.id));
      this.ground.setDepth(3); // above terrain and roads, below all y-sorted sprites
    }

    this.image = scene.add.image(def.x, def.y, def.imageKey);
    this.image.setOrigin(0.5, 1); // bottom-centre — the def's y IS the ground line
    // The theme decides; it corrects for building art drawn at differing zooms
    // so that a doorway is the same size on every building.
    this.image.setScale(getActiveTheme().getBuildingScale(def.id));
    this.image.setInteractive({ useHandCursor: true });

    // Click handler — emit the building id AND the pointer's screen-space
    // position so the React panel can anchor itself next to the clicked
    // structure instead of always opening at the viewport center.
    this.image.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      eventBridge.emit('building:clicked', {
        id: def.id,
        screenX: pointer.x,
        screenY: pointer.y,
      });
    });

    // Hover highlight
    this.image.on('pointerover', () => {
      this.image.setTint(0xdddddd);
    });
    this.image.on('pointerout', () => {
      this.image.clearTint();
    });

    // Door position: just below the image bottom (origin is bottom-center, so y IS the bottom)
    this.doorX = def.x;
    this.doorY = def.y + 5;

    // Y-based depth: use doorY (bottom edge) so heroes sort correctly
    this.image.setDepth(this.doorY);

    // Label above building — image top is at y - displayHeight (since origin is bottom)
    const labelY = def.y - this.image.displayHeight - 8;
    this.label = addCrispText(scene, def.x, labelY, def.label, {
      fontSize: '17px',
      fontStyle: '600',
      color: '#F5E6C8',
      fontFamily: LABEL_FONT,
      stroke: '#000000',
      strokeThickness: 2,
      shadow: { offsetX: 0, offsetY: 1, color: '#000', blur: 3, fill: true },
    }).setOrigin(0.5, 1).setDepth(this.doorY + 0.1);

    // Subtitle (description) below the label — pushed 5px down to clear the
    // title's descenders and avoid muddiness in the overlap zone.
    addCrispText(scene, def.x, labelY + 5, def.activity, {
      fontSize: '13px',
      color: '#d8d8d8',
      fontFamily: LABEL_FONT,
      stroke: '#000000',
      strokeThickness: 1,
      shadow: { offsetX: 0, offsetY: 1, color: '#000', blur: 2, fill: true },
    }).setOrigin(0.5, 0).setDepth(this.doorY + 0.1);
  }

  /**
   * Chimney smoke while someone is working inside — the one piece of building
   * state readable from right across the map. The anchor comes from the theme
   * in image pixels; smoke scales with the building so the plume stays
   * proportionate.
   */
  setSmoking(smoking: boolean): void {
    if (!smoking) {
      this.smoke?.destroy();
      this.smoke = null;
      return;
    }
    if (this.smoke !== null) return;
    const anchor = getActiveTheme().getChimneyAnchor?.(this.def.id);
    if (anchor == null) return;
    if (!this.scene.textures.exists('vfx-chimneysmoke') || !this.scene.anims.exists('vfx-chimneysmoke-anim')) return;
    const scale = this.image.scaleX;
    const [ax, ay] = anchor;
    const x = this.def.x - this.image.displayWidth / 2 + ax * scale;
    const y = this.def.y - this.image.displayHeight + ay * scale;
    this.smoke = this.scene.add.sprite(x, y, 'vfx-chimneysmoke');
    this.smoke.setOrigin(0.5, 1);
    this.smoke.setScale(scale);
    this.smoke.setAlpha(0.9);
    this.smoke.setDepth(this.doorY + 0.15);
    this.smoke.play('vfx-chimneysmoke-anim');
  }

  /**
   * Where stationed heroes may stand, in world space — only for enclosures
   * (arena, farm). Ordinary buildings return null and their heroes gather at
   * the door.
   */
  interiorWorldRect(): { x: number; y: number; w: number; h: number } | null {
    if (this.interior === null) return null;
    const scale = this.image.scaleX;
    const [ix, iy, iw, ih] = this.interior;
    return {
      x: this.def.x - this.image.displayWidth / 2 + ix * scale,
      y: this.def.y - this.image.displayHeight + iy * scale,
      w: iw * scale,
      h: ih * scale,
    };
  }

  /**
   * Ground plan used for road routing, in world space.
   *
   * NOT the sprite's bounding box: these are tall buildings drawn in
   * three-quarter view, so most of the image is roof and upper wall that a
   * path may happily pass behind. Only the lower band actually stands on the
   * ground, so roads route around that and heroes can still walk behind the
   * upper storeys — which is what makes the depth sorting read correctly.
   *
   * Enclosures are the exception: a fence ring is ALL ground — there is no
   * upper storey to walk behind — so their footprint is the whole image and
   * roads (and scenery) keep out of the yard entirely.
   */
  get footprint(): { x: number; y: number; w: number; h: number } {
    if (this.interior !== null) {
      const w = this.image.displayWidth * 0.96;
      const h = this.image.displayHeight * 0.94;
      return { x: this.def.x - w / 2, y: this.def.y - h, w, h };
    }
    const w = this.image.displayWidth * 0.78;
    const h = Math.max(24, this.image.displayHeight * 0.34);
    return { x: this.def.x - w / 2, y: this.def.y - h, w, h };
  }
}
