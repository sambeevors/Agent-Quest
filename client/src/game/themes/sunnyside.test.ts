import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { sunnysideTheme } from './sunnyside';
import { SUNNYSIDE_SHEET } from './sunnyside-sheet';
import { HERO_COLORS, HERO_CLASSES } from '../../types/agent';

/**
 * The invariants that keep the village legible, pinned against the generated
 * bake metadata rather than magic numbers where possible.
 */

const BUILDING_IDS = Object.keys(SUNNYSIDE_SHEET.buildings.doorHeight);

describe('sunnysideTheme buildings', () => {
  test('every activity building has a door height and a size', () => {
    expect(BUILDING_IDS.sort()).toEqual(
      ['alchemist', 'arena', 'castle', 'farm', 'forge', 'library', 'tavern', 'watchtower'],
    );
  });

  test('enclosures declare an interior that fits inside their image', () => {
    // The arena and farm are the two buildings heroes physically enter.
    expect(Object.keys(SUNNYSIDE_SHEET.buildings.interior).sort()).toEqual(['arena', 'farm']);
    for (const [id, rect] of Object.entries(SUNNYSIDE_SHEET.buildings.interior)) {
      const [w, h] = SUNNYSIDE_SHEET.buildings.size[id as keyof typeof SUNNYSIDE_SHEET.buildings.size];
      const [ix, iy, iw, ih] = rect;
      expect(ix).toBeGreaterThan(0);
      expect(iy).toBeGreaterThan(0);
      expect(ix + iw).toBeLessThan(w);
      expect(iy + ih).toBeLessThan(h);
      expect(sunnysideTheme.getBuildingInterior?.(id)).toEqual(rect);
    }
    expect(sunnysideTheme.getBuildingInterior?.('library')).toBeNull();
  });

  test('enclosures have no chimney — nothing to smoke on a fence', () => {
    const chimneyIds = Object.keys(SUNNYSIDE_SHEET.buildings.chimney);
    expect(chimneyIds).not.toContain('arena');
    expect(chimneyIds).not.toContain('farm');
  });

  test('the arena cast idles and attacks off real sheet rows', () => {
    const npcs = sunnysideTheme.getArenaNpcs?.() ?? [];
    expect(npcs.map((n) => n.textureKey).sort()).toEqual(['hero-goblin', 'npc-skeleton']);
    for (const npc of npcs) {
      expect(npc.idle.frameIndices.length).toBeGreaterThan(1);
      expect(npc.attack.frameIndices.length).toBeGreaterThan(1);
    }
  });

  test('doorways render at one size across all buildings', () => {
    // scale * doorHeight is the on-screen doorway height. The bake composes
    // every building at one zoom and measures each doorway, so this product
    // must come out identical for all 8 — that is the whole point of the
    // DOOR_HEIGHT mechanism.
    const products = BUILDING_IDS.map(
      (id) => sunnysideTheme.getBuildingScale(id) * SUNNYSIDE_SHEET.buildings.doorHeight[id as keyof typeof SUNNYSIDE_SHEET.buildings.doorHeight],
    );
    for (const p of products) {
      expect(Math.abs(p - products[0]!)).toBeLessThan(1e-6);
    }
  });

  test('a doorway is proportioned to a hero', () => {
    // The baked hero is (footY - headY) px of drawing, as the bake measured
    // it; on screen it stands that times heroScale. A door should be near
    // hero height — between 0.9x and 1.6x — or heroes visibly clip or rattle
    // around.
    const heroHeight = (SUNNYSIDE_SHEET.heroes.footY - SUNNYSIDE_SHEET.heroes.headY) * sunnysideTheme.heroScale;
    const door = sunnysideTheme.getBuildingScale('forge') * SUNNYSIDE_SHEET.buildings.doorHeight.forge;
    expect(door).toBeGreaterThan(heroHeight * 0.9);
    expect(door).toBeLessThan(heroHeight * 1.6);
  });

  test('each baked building fills its image, so the image rect is its true extent', () => {
    // Roads keep off a structure's whole image rect (`spriteRect`). That is
    // only honest if the art fills it: transparent margins would push every
    // road needlessly wide of the walls. Measured, the buildings fill 93–100% of
    // their image each way.
    const dir = join(import.meta.dir, '../../../public/assets/themes/sunnyside/buildings');
    const fill = (file: string, min: number): void => {
      const { width, height, box } = opaqueBox(join(dir, file));
      expect({ file, w: (box.x1 - box.x0) / width >= min, h: (box.y1 - box.y0) / height >= min })
        .toEqual({ file, w: true, h: true });
    };
    for (const id of BUILDING_IDS) fill(`${id}.png`, 0.93);
  });

  test('unknown building ids fall back to the base scale', () => {
    expect(sunnysideTheme.getBuildingScale('gazebo')).toBe(sunnysideTheme.buildingScale);
  });
});

describe('sunnysideTheme heroes', () => {
  test('ships a sheet for every class x colour, plus the goblin', () => {
    const keys = new Set(sunnysideTheme.getHeroPreload().map((e) => e.key));
    for (const klass of HERO_CLASSES) {
      for (const color of HERO_COLORS) {
        expect(keys.has(`hero-${klass}-${color}`)).toBe(true);
      }
    }
    expect(keys.has('hero-goblin')).toBe(true);
  });

  test('walk and idle frame indices stay inside their sheet rows', () => {
    const cfg = sunnysideTheme.getHeroConfig('blue', 'warrior');
    const cols = SUNNYSIDE_SHEET.heroes.columns;
    expect(cfg.runFrameIndices).toEqual(
      Array.from({ length: SUNNYSIDE_SHEET.heroes.anims.walk.frames }, (_, i) => i),
    );
    for (const idx of cfg.idleFrameIndices ?? []) {
      expect(Math.floor(idx / cols)).toBe(SUNNYSIDE_SHEET.heroes.anims.idle.row);
    }
  });

  test('every character sheet declares where its figure stands in the frame', () => {
    // Labels hang off headY and depth sorts on footY, so both must lie inside
    // the frame — and NOT at its edges: a 96x64 frame holds a ~19px figure,
    // and the frame edges are the very assumption that floated names ~35px
    // above heads and sorted heroes in front of trees they stood behind.
    const sheets = [SUNNYSIDE_SHEET.heroes, SUNNYSIDE_SHEET.goblin, SUNNYSIDE_SHEET.skeleton];
    const frameH = SUNNYSIDE_SHEET.heroes.frameHeight;
    for (const { headY, footY } of sheets) {
      expect(headY).toBeGreaterThan(0);
      expect(footY).toBeLessThan(frameH);
      expect(footY - headY).toBeGreaterThan(12);
      expect(footY - headY).toBeLessThan(frameH / 2);
    }
  });

  test('hero and arena configs carry the measured extent of their own sheet', () => {
    const human = sunnysideTheme.getHeroConfig('blue', 'archer');
    expect(human.extent).toEqual({
      frameHeight: SUNNYSIDE_SHEET.heroes.frameHeight,
      headY: SUNNYSIDE_SHEET.heroes.headY,
      footY: SUNNYSIDE_SHEET.heroes.footY,
    });
    const goblin = sunnysideTheme.getHeroConfig('blue', 'archer', 'codex');
    expect(goblin.extent.headY).toBe(SUNNYSIDE_SHEET.goblin.headY);
    expect(goblin.extent.footY).toBe(SUNNYSIDE_SHEET.goblin.footY);
    const npcs = sunnysideTheme.getArenaNpcs?.() ?? [];
    const skeleton = npcs.find((n) => n.textureKey === 'npc-skeleton');
    expect(skeleton?.extent.footY).toBe(SUNNYSIDE_SHEET.skeleton.footY);
  });

  test('codex sessions get the goblin sheet', () => {
    const cfg = sunnysideTheme.getHeroConfig('blue', 'warrior', 'codex');
    expect(cfg.idleKey).toBe('hero-goblin');
    const preview = sunnysideTheme.getHeroPreview('blue', 'warrior', 'codex');
    expect(preview.url).toContain('portrait-goblin');
  });

  test('activity animations exist for the mapped states and index one texture', () => {
    const cfg = sunnysideTheme.getHeroConfig('red', 'pawn');
    for (const state of ['editing', 'bash', 'debugging', 'git', 'waiting']) {
      const anim = cfg.extraAnims?.[state];
      expect(anim).toBeDefined();
      expect(anim!.frameIndices.length).toBeGreaterThan(1);
    }
    // Unmapped states fall back to idle in HeroSprite.
    expect(cfg.extraAnims?.['reading']).toBeUndefined();
  });
});

describe('sunnysideTheme terrain', () => {
  test('road sheet matches the path-tiles contract', () => {
    const road = sunnysideTheme.terrain?.road;
    expect(road).toBeDefined();
    expect(road!.columns).toBe(6);
    expect(road!.blockFrame).toBe(0);
    expect(road!.gravelFrame).toBe(4);
    expect(road!.tuftFrame).toBe(5);
  });

  test('the water tileset key keeps its load-bearing substring', () => {
    // game/data/water.ts derives the lake keep-out from tiles whose tileset
    // key contains 'water'.
    const statics = sunnysideTheme.getStaticAssetPreload();
    expect(statics.some((e) => e.key.includes('water'))).toBe(true);
  });
});

/**
 * Bounding box of the non-transparent pixels in an 8-bit RGBA PNG — the
 * only format the bake writes. Minimal decoder: IDAT inflate + unfiltering.
 */
function opaqueBox(file: string): { width: number; height: number; box: { x0: number; y0: number; x1: number; y1: number } } {
  const buf = readFileSync(file);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  expect([buf[24], buf[25], buf[28]]).toEqual([8, 6, 0]); // 8-bit, RGBA, non-interlaced
  const idat: Buffer[] = [];
  for (let off = 8; off < buf.length;) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? px[y * stride + i - 4]! : 0;
      const b = y > 0 ? px[(y - 1) * stride + i]! : 0;
      const c = i >= 4 && y > 0 ? px[(y - 1) * stride + i - 4]! : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + i] = (raw[src + i]! + pred) & 0xff;
    }
  }
  const box = { x0: width, y0: height, x1: 0, y1: 0 };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (px[y * stride + x * 4 + 3]! === 0) continue;
      box.x0 = Math.min(box.x0, x);
      box.y0 = Math.min(box.y0, y);
      box.x1 = Math.max(box.x1, x + 1);
      box.y1 = Math.max(box.y1, y + 1);
    }
  }
  return { width, height, box };
}
