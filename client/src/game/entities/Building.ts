import * as Phaser from 'phaser';
import type { BuildingDef } from '../data/building-layout';
import { spriteRect } from '../data/building-plan';
import { eventBridge } from '../EventBridge';
import { addCrispText, LABEL_FONT } from '../text';
import { buildingLabel, getActiveTheme } from '../themes/registry';

/** Clear air between the building's top (chimney included) and its subtitle. */
const BUILDING_LABEL_GAP = 6;
/** How far the title's bottom tucks into the subtitle's box — the text boxes
 *  carry padding for stroke and shadow that would otherwise read as a gap. */
const BUILDING_LABEL_LEADING = 3;
/** Depth offsets from the door line: the smoke sorts with its building, and
 *  the labels just above it so the plume passes behind the text. */
const SMOKE_DEPTH_OFFSET = 0.15;
const BUILDING_LABEL_DEPTH_OFFSET = 0.2;

export class Building {
  readonly def: BuildingDef;
  readonly image: Phaser.GameObjects.Image;
  readonly label: Phaser.GameObjects.Text;
  readonly doorX: number;
  readonly doorY: number;
  private readonly scene: Phaser.Scene;
  private smoke: Phaser.GameObjects.Sprite | null = null;
  /** The open-door overlay some themes show instead of smoke. */
  private openDoor: Phaser.GameObjects.Image | null = null;
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

    // Title and subtitle stack ENTIRELY above the image. The image top is the
    // building's silhouette top — every chimney anchor is at or below it — so
    // nothing of the roof or chimney sits under the text. The subtitle used to
    // hang 5px into the image, which on every roofed hall was exactly where
    // the chimney is drawn.
    const top = def.y - this.image.displayHeight;
    const label = buildingLabel(def);
    const subtitle = addCrispText(scene, def.x, top - BUILDING_LABEL_GAP, def.activity, {
      fontSize: '13px',
      color: '#d8d8d8',
      fontFamily: LABEL_FONT,
      stroke: '#000000',
      strokeThickness: 1,
      shadow: { offsetX: 0, offsetY: 1, color: '#000', blur: 2, fill: true },
    }).setOrigin(0.5, 1);

    this.label = addCrispText(scene, def.x, subtitle.y - subtitle.displayHeight + BUILDING_LABEL_LEADING, label, {
      fontSize: '17px',
      fontStyle: '600',
      color: '#F5E6C8',
      fontFamily: LABEL_FONT,
      stroke: '#000000',
      strokeThickness: 2,
      shadow: { offsetX: 0, offsetY: 1, color: '#000', blur: 3, fill: true },
    }).setOrigin(0.5, 1);

    // Every chimney sits on its hall's centre line — right under the text —
    // so the plume necessarily rises through it. The text is drawn OVER the
    // smoke (see setSmoking's depth): the black-stroked label stays legible
    // and the plume reads as rising behind the sign, not as fog on it.
    subtitle.setDepth(this.doorY + BUILDING_LABEL_DEPTH_OFFSET);
    this.label.setDepth(this.doorY + BUILDING_LABEL_DEPTH_OFFSET);
  }

  /**
   * Chimney smoke while someone is working inside — the one piece of building
   * state readable from right across the map. The anchor comes from the theme
   * in image pixels; smoke scales with the building so the plume stays
   * proportionate.
   */
  setSmoking(smoking: boolean): void {
    this.setDoorOpen(smoking);
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
    this.smoke.setDepth(this.doorY + SMOKE_DEPTH_OFFSET);
    this.smoke.play('vfx-chimneysmoke-anim');
  }

  /**
   * Where stationed heroes may stand, in world space — only for enclosures
   * (arena, farm). Ordinary buildings return null and their heroes gather at
   * the door.
   */
  /**
   * The same occupancy signal as smoke, for themes whose buildings have no
   * chimney: the door stands open while a hero is inside. The overlay is the
   * building image's own size, so it lines up by construction.
   */
  private setDoorOpen(open: boolean): void {
    if (!open) {
      this.openDoor?.destroy();
      this.openDoor = null;
      return;
    }
    if (this.openDoor !== null) return;
    const key = `${this.def.imageKey}-open`;
    if (getActiveTheme().hasOpenDoorOverlay?.(this.def.id) !== true || !this.scene.textures.exists(key)) return;
    this.openDoor = this.scene.add.image(this.def.x, this.def.y, key);
    this.openDoor.setOrigin(0.5, 1);
    this.openDoor.setScale(this.image.scaleX);
    this.openDoor.setDepth(this.doorY + SMOKE_DEPTH_OFFSET);
  }

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
   * The enclosure's points of interest in world space — the farm's tilled
   * beds. Same image-pixel → world conversion as interiorWorldRect, so the
   * beds stay under the crops however the building is scaled or moved.
   */
  cropWorldPoints(): Array<{ x: number; y: number }> | null {
    const crops = getActiveTheme().getBuildingCrops?.(this.def.id);
    if (crops == null || crops.length === 0) return null;
    const scale = this.image.scaleX;
    const left = this.def.x - this.image.displayWidth / 2;
    const top = this.def.y - this.image.displayHeight;
    return crops.map(([cx, cy]) => ({ x: left + cx * scale, y: top + cy * scale }));
  }

  /**
   * Ground the roads keep off, in world space: the whole drawn sprite. See
   * `spriteRect` for why it is not a ground band — measured off the baked
   * art, the walls run the full width down to the ground, and a road let
   * behind the upper storey pokes out past the eaves.
   */
  get footprint(): { x: number; y: number; w: number; h: number } {
    return spriteRect(this.def.x, this.def.y, this.image.displayWidth, this.image.displayHeight);
  }
}
