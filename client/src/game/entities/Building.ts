import * as Phaser from 'phaser';
import type { BuildingDef } from '../data/building-layout';
import { eventBridge } from '../EventBridge';
import { addCrispText, LABEL_FONT } from '../text';
import { footOf, TILE, tileRectToWorld, TOWN_BUILDINGS, type Point, type TownBuilding } from '../town/town';

/** Building names sit above the overhead layer (roof eaves, tree crowns)
 * and below the heroes' own labels. */
export const BUILDING_LABEL_DEPTH = 3500;
/** Open-door frames replace part of the ground: above it, below every sprite. */
const DOOR_DEPTH = 1;
/** Clear air between the building's top and its subtitle. */
const BUILDING_LABEL_GAP = 4;
/** How far the title's bottom tucks into the subtitle's box — the text boxes
 *  carry padding for stroke and shadow that would otherwise read as a gap. */
const BUILDING_LABEL_LEADING = 3;

/**
 * One place in Cerulean City that an activity sends trainers to.
 *
 * The building itself is part of the baked town — drawn into `ground.png`
 * and `overhead.png` exactly as FireRed draws it — so this is the layer of
 * meaning on top: its name and activity over the roof, a click target over
 * its footprint, the tiles its trainers stand on, and its door, which stands
 * open while one of them is inside (the town's occupancy tell, where the old
 * village had chimney smoke).
 */
export class Building {
  readonly def: BuildingDef;
  readonly place: TownBuilding;
  readonly label: Phaser.GameObjects.Text;
  private readonly scene: Phaser.Scene;
  private readonly zone: Phaser.GameObjects.Zone;
  private readonly highlight: Phaser.GameObjects.Rectangle;
  private openDoors: Phaser.GameObjects.Image[] = [];

  constructor(scene: Phaser.Scene, def: BuildingDef) {
    this.def = def;
    this.scene = scene;
    const place = TOWN_BUILDINGS[def.id];
    if (place === undefined) throw new Error(`town has no place for '${def.id}'`);
    this.place = place;

    const rect = tileRectToWorld(place.rect);
    this.highlight = scene.add.rectangle(rect.x, rect.y, rect.w, rect.h, 0xffffff, 0.12)
      .setOrigin(0, 0)
      .setStrokeStyle(2, 0xf8f8f8, 0.6)
      .setDepth(BUILDING_LABEL_DEPTH - 1)
      .setVisible(false);

    // Click target over the footprint. Emits the pointer's screen position
    // so the React panel can anchor itself next to the clicked building.
    this.zone = scene.add.zone(rect.x, rect.y, rect.w, rect.h).setOrigin(0, 0);
    this.zone.setInteractive({ useHandCursor: true });
    this.zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      eventBridge.emit('building:clicked', { id: def.id, screenX: pointer.x, screenY: pointer.y });
    });
    this.zone.on('pointerover', () => this.highlight.setVisible(true));
    this.zone.on('pointerout', () => this.highlight.setVisible(false));

    // Title and subtitle stack above the footprint — or on the roof, where
    // the space above belongs to a neighbour.
    const cx = rect.x + rect.w / 2;
    const baseY = place.labelInside ? rect.y + TILE * 1.5 : rect.y - BUILDING_LABEL_GAP;
    const subtitle = addCrispText(scene, cx, baseY, def.activity, {
      fontSize: '13px',
      color: '#d8d8d8',
      fontFamily: LABEL_FONT,
      stroke: '#000000',
      strokeThickness: 1,
      shadow: { offsetX: 0, offsetY: 1, color: '#000', blur: 2, fill: true },
    }).setOrigin(0.5, 1);

    this.label = addCrispText(scene, cx, subtitle.y - subtitle.displayHeight + BUILDING_LABEL_LEADING, def.label, {
      fontSize: '17px',
      fontStyle: '600',
      color: '#F8F8F8',
      fontFamily: LABEL_FONT,
      stroke: '#000000',
      strokeThickness: 2,
      shadow: { offsetX: 0, offsetY: 1, color: '#000', blur: 3, fill: true },
    }).setOrigin(0.5, 1);

    subtitle.setDepth(BUILDING_LABEL_DEPTH);
    this.label.setDepth(BUILDING_LABEL_DEPTH);
  }

  /** Where this building's trainers stand — feet positions, best first. */
  slotFeet(): Point[] {
    return this.place.slots.map(footOf);
  }

  /**
   * What a trainer stationed here turns to face: the door it's waiting at
   * (whichever is nearest, for the Bike Shop's pair), or null for an
   * open-air place.
   */
  doorFocus(feet: Point): Point | null {
    let best: Point | null = null;
    let bestD = Infinity;
    for (const [x, y] of this.place.doors) {
      const p = { x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 };
      const d = Math.abs(p.x - feet.x) + Math.abs(p.y - feet.y);
      if (d < bestD) { best = p; bestD = d; }
    }
    return best;
  }

  /** Open the doors while a trainer is inside; close them when the last leaves. */
  setOccupied(occupied: boolean): void {
    if (!occupied) {
      for (const d of this.openDoors) d.destroy();
      this.openDoors = [];
      return;
    }
    if (this.openDoors.length > 0) return;
    for (const { key, tile } of this.place.doorOverlays) {
      if (!this.scene.textures.exists(key)) continue;
      const img = this.scene.add.image(tile[0] * TILE, tile[1] * TILE, key).setOrigin(0, 0).setDepth(DOOR_DEPTH);
      this.openDoors.push(img);
    }
  }
}
