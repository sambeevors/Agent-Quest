import { describe, test, expect } from 'bun:test';
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
      ['alchemist', 'arena', 'castle', 'chapel', 'forge', 'library', 'tavern', 'watchtower'],
    );
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
    // The baked hero is ~15px of drawing; on screen it stands
    // 15 * heroScale tall. A door should be near hero height — between
    // 0.9x and 1.6x — or heroes visibly clip or rattle around.
    const heroHeight = 15 * sunnysideTheme.heroScale;
    const door = sunnysideTheme.getBuildingScale('forge') * SUNNYSIDE_SHEET.buildings.doorHeight.forge;
    expect(door).toBeGreaterThan(heroHeight * 0.9);
    expect(door).toBeLessThan(heroHeight * 1.6);
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
