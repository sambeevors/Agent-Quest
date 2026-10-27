import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  generateScenery, sceneryFootprint, treeBase, SCENERY_ART_SIZE, SCENERY_GAP,
  type RoadSurface, type SceneryItem, type SceneryOptions,
} from './scenery';
import { buildDesireNetwork, type Point, type Rect } from './desire-paths';
import { planRoads, spriteRect, type RoadSite } from './building-plan';
import { buildPathTilemap } from './path-tiles';
import { waterKeepOut } from './water';
import type { TerrainCell } from './map-config';
import { WORLD_WIDTH, WORLD_HEIGHT } from './building-layout';
import { SUNNYSIDE_SHEET } from '../themes/sunnyside-sheet';
import { sunnysideTheme } from '../themes/sunnyside';

const BOUNDS: Rect = { x: 0, y: 0, w: 1200, h: 900 };
const NO_ROADS: RoadSurface = { cell: 32, tiles: [] };

function distToRect(p: Point, r: Rect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

/** Gap between two rects, edge to edge; 0 when they touch or overlap. */
function rectGap(a: Rect, b: Rect): number {
  const dx = Math.max(b.x - (a.x + a.w), 0, a.x - (b.x + b.w));
  const dy = Math.max(b.y - (a.y + a.h), 0, a.y - (b.y + b.h));
  return Math.hypot(dx, dy);
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Road cells drawn under a rect — what the eye sees as "on the road". */
function roadCellsUnder(r: Rect, roads: RoadSurface): number {
  let n = 0;
  for (const t of roads.tiles) {
    if (overlaps(r, { x: t.col * roads.cell, y: t.row * roads.cell, w: roads.cell, h: roads.cell })) n++;
  }
  return n;
}

/** A drawn road along a polyline, rasterised exactly as the game does. */
function roadFrom(points: Point[], traffic = 1): RoadSurface {
  return buildPathTilemap({ roads: [{ points, traffic }], waypoints: [], edges: [] });
}

const describeItem = (i: SceneryItem) => `${i.kind}-${i.variant}@${Math.round(i.x)},${Math.round(i.y)}`;

/**
 * Every pair of static sprites, other than two trees, closer than
 * `SCENERY_GAP` — pairwise and brute force, so it can't share a bug with the
 * generator's spatial index.
 */
function spriteClashes(items: readonly SceneryItem[]): string[] {
  const statics = items.filter((i) => i.kind !== 'animal');
  const rects = statics.map(sceneryFootprint);
  const out: string[] = [];
  for (let a = 0; a < statics.length; a++) {
    for (let b = a + 1; b < statics.length; b++) {
      if (statics[a]!.kind === 'tree' && statics[b]!.kind === 'tree') continue;
      if (rectGap(rects[a]!, rects[b]!) < SCENERY_GAP) {
        out.push(`${describeItem(statics[a]!)} / ${describeItem(statics[b]!)}`);
      }
    }
  }
  return out;
}

/** Tree pairs where either sprite reaches the other's trunk band. */
function trunksHidden(items: readonly SceneryItem[]): string[] {
  const trees = items.filter((i) => i.kind === 'tree');
  const out: string[] = [];
  for (let a = 0; a < trees.length; a++) {
    for (let b = a + 1; b < trees.length; b++) {
      const ta = trees[a]!;
      const tb = trees[b]!;
      if (overlaps(sceneryFootprint(ta), treeBase(tb)) || overlaps(sceneryFootprint(tb), treeBase(ta))) {
        out.push(`${describeItem(ta)} / ${describeItem(tb)}`);
      }
    }
  }
  return out;
}

/** Animals whose spawn frame overlaps any other scenery sprite. */
function animalsInsideSprites(items: readonly SceneryItem[]): string[] {
  const out: string[] = [];
  for (const a of items.filter((i) => i.kind === 'animal')) {
    const art = sceneryFootprint(a);
    for (const o of items) {
      if (o !== a && overlaps(art, sceneryFootprint(o))) out.push(`${describeItem(a)} / ${describeItem(o)}`);
    }
  }
  return out;
}

function opts(over: Partial<SceneryOptions> = {}): SceneryOptions {
  return { bounds: BOUNDS, buildings: [], roads: NO_ROADS, ...over };
}

// ---------------------------------------------------------------------------
// The shipped village, laid out without Phaser exactly as VillageScene does.
// ---------------------------------------------------------------------------

interface VillageLayout {
  footprints: Rect[];
  sprites: Rect[];
  roads: RoadSurface;
  water: Rect[];
  options: SceneryOptions;
}

function shippedVillage(): VillageLayout {
  const path = join(import.meta.dir, '../../../../server/data/map/village.json');
  const map = JSON.parse(readFileSync(path, 'utf8')) as {
    buildings: Array<{ id: string; x: number; y: number }>;
    spawn: Point;
    terrain: Record<string, TerrainCell>;
  };
  const sizes = SUNNYSIDE_SHEET.buildings.size as Record<string, readonly [number, number]>;
  const sites: RoadSite[] = [];
  for (const b of map.buildings) {
    const size = sizes[b.id];
    if (size === undefined) continue;
    const scale = sunnysideTheme.getBuildingScale(b.id);
    // Mirrors Building.footprint: the whole sprite is road keep-out.
    sites.push({ id: `b:${b.id}`, door: { x: b.x, y: b.y + 5 }, keepOut: spriteRect(b.x, b.y, size[0] * scale, size[1] * scale) });
  }
  const footprints = sites.map((s) => s.keepOut);
  const sprites = footprints.map((r) => ({ ...r }));
  const world: Rect = { x: 0, y: 0, w: WORLD_WIDTH, h: WORLD_HEIGHT };
  const cell = sunnysideTheme.terrain!.tileSize / 2;
  const plan = planRoads(sites, map.spawn, cell);
  const roads = buildPathTilemap(buildDesireNetwork(plan.nodes, plan.obstacles, { clearance: plan.clearance }), {
    cell,
    bounds: world,
  });
  const water = waterKeepOut(map.terrain);
  return {
    footprints, sprites, roads, water,
    options: { bounds: world, buildings: footprints, buildingSprites: sprites, roads, exclusions: water },
  };
}

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): [number, number] {
  const buf = readFileSync(file);
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

describe('generateScenery', () => {
  test('produces a populated, in-bounds scatter', () => {
    const items = generateScenery(opts());
    expect(items.length).toBeGreaterThan(50);
    for (const i of items) {
      expect(i.x).toBeGreaterThanOrEqual(BOUNDS.x);
      expect(i.x).toBeLessThanOrEqual(BOUNDS.x + BOUNDS.w + 60);
      expect(i.y).toBeGreaterThanOrEqual(BOUNDS.y);
      expect(i.y).toBeLessThanOrEqual(BOUNDS.y + BOUNDS.h + 60);
    }
  });

  test('no sprite overlaps a building ground plan', () => {
    const building: Rect = { x: 500, y: 400, w: 160, h: 90 };
    const items = generateScenery(opts({ buildings: [building] }));
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) {
      expect(rectGap(sceneryFootprint(i), building)).toBeGreaterThan(0);
    }
  });

  test('no sprite comes near a building sprite, roof and eaves included', () => {
    // The ground plan is a low band at the base; the drawn hall towers over it.
    const ground: Rect = { x: 520, y: 450, w: 120, h: 40 };
    const sprite: Rect = { x: 500, y: 300, w: 160, h: 190 };
    const items = generateScenery(opts({ buildings: [ground], buildingSprites: [sprite] }));
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) {
      // The smallest wall gap of any kind is the flower's 6px.
      expect(rectGap(sceneryFootprint(i), sprite)).toBeGreaterThanOrEqual(6);
    }
  });

  test('no sprite overlaps the drawn road surface', () => {
    const roads = roadFrom([{ x: 0, y: 450 }, { x: 1200, y: 450 }]);
    const items = generateScenery(opts({ roads }));
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) {
      expect(roadCellsUnder(sceneryFootprint(i), roads)).toBe(0);
    }
  });

  test('keeps clear of a winding road, not just a straight one', () => {
    const roads = roadFrom([
      { x: 0, y: 100 }, { x: 300, y: 400 }, { x: 600, y: 200 },
      { x: 900, y: 700 }, { x: 1200, y: 300 },
    ]);
    const items = generateScenery(opts({ roads }));
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) {
      expect(roadCellsUnder(sceneryFootprint(i), roads)).toBe(0);
    }
  });

  test('a boulder keeps well back from roads and walls; a pebble may sit closer', () => {
    // Dense enough to place many rocks on both sides of a road past a hall.
    const roads = roadFrom([{ x: 0, y: 450 }, { x: 1200, y: 450 }]);
    const sprite: Rect = { x: 500, y: 200, w: 200, h: 160 };
    const items = generateScenery(opts({ roads, buildingSprites: [sprite], cell: 20 }));
    const rocks = items.filter((i) => i.kind === 'rock');
    const boulders = rocks.filter((r) => [1, 2, 5].includes(r.variant));
    expect(boulders.length).toBeGreaterThan(0);
    for (const b of boulders) {
      const art = sceneryFootprint(b);
      expect(rectGap(art, sprite)).toBeGreaterThanOrEqual(40);
      const grown = { x: art.x - 24, y: art.y - 24, w: art.w + 48, h: art.h + 48 };
      expect(roadCellsUnder(grown, roads)).toBe(0);
    }
  });

  test('boulders are the rare rock, not the common one', () => {
    const rocks = generateScenery(opts({ bounds: { x: 0, y: 0, w: 3000, h: 2000 } }))
      .filter((i) => i.kind === 'rock');
    expect(rocks.length).toBeGreaterThan(40);
    const boulders = rocks.filter((r) => [1, 2, 5].includes(r.variant)).length;
    expect(boulders / rocks.length).toBeLessThan(0.4);
  });

  test('no sprite reaches into an exclusion rect', () => {
    const lake: Rect = { x: 200, y: 200, w: 400, h: 300 };
    const items = generateScenery(opts({ exclusions: [lake] }));
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) {
      expect(distToRect(i, lake)).toBeGreaterThan(0);
      expect(overlaps(sceneryFootprint(i), lake)).toBe(false);
    }
  });

  test('is deterministic for a given seed, and varies with it', () => {
    const a = generateScenery(opts({ seed: 42 }));
    const b = generateScenery(opts({ seed: 42 }));
    const c = generateScenery(opts({ seed: 43 }));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  test('thins out near a settlement so it sits in a clearing', () => {
    const building: Rect = { x: 560, y: 400, w: 160, h: 90 };
    const items = generateScenery(opts({ buildings: [building] }));
    const centre = { x: 640, y: 445 };
    const near = items.filter((i) => Math.hypot(i.x - centre.x, i.y - centre.y) < 300).length;
    const far = items.filter((i) => {
      const d = Math.hypot(i.x - centre.x, i.y - centre.y);
      return d >= 300 && d < 600;
    }).length;
    // Compare by area — the outer annulus is larger, so raw counts would not
    // be a fair comparison.
    const nearArea = Math.PI * 300 ** 2;
    const farArea = Math.PI * (600 ** 2 - 300 ** 2);
    expect(near / nearArea).toBeLessThan(far / farArea);
  });

  test('no two sprites overlap, whatever their kinds, even at high density', () => {
    // A cell well under any sprite's width throws several candidates at
    // every patch of ground, so a missed cross-kind check can't hide.
    for (const seed of [1, 2, 3]) {
      const items = generateScenery(opts({
        seed, cell: 16, density: 2,
        roads: roadFrom([{ x: 0, y: 450 }, { x: 1200, y: 450 }]),
        buildings: [{ x: 500, y: 200, w: 200, h: 120 }],
      }));
      expect(items.length).toBeGreaterThan(200);
      expect(new Set(items.map((i) => i.kind)).size).toBeGreaterThan(4);
      expect(spriteClashes(items)).toEqual([]);
      expect(trunksHidden(items)).toEqual([]);
      expect(animalsInsideSprites(items)).toEqual([]);
    }
  });

  test('trees may interlock crowns, but never hide a trunk', () => {
    // The one overlap allowed — it is what keeps woodland from reading as an
    // orchard — so it must actually occur, or the rule above is untested.
    const items = generateScenery(opts({ cell: 16, density: 2 }));
    const trees = items.filter((i) => i.kind === 'tree');
    let interlocked = 0;
    for (let a = 0; a < trees.length; a++) {
      for (let b = a + 1; b < trees.length; b++) {
        if (overlaps(sceneryFootprint(trees[a]!), sceneryFootprint(trees[b]!))) interlocked++;
      }
    }
    expect(interlocked).toBeGreaterThan(0);
    expect(trunksHidden(items)).toEqual([]);
  });

  test('spaces items of the same kind apart', () => {
    const items = generateScenery(opts());
    const trees = items.filter((i) => i.kind === 'tree');
    for (let i = 0; i < trees.length; i++) {
      for (let j = i + 1; j < trees.length; j++) {
        expect(Math.hypot(trees[i]!.x - trees[j]!.x, trees[i]!.y - trees[j]!.y))
          .toBeGreaterThanOrEqual(40);
      }
    }
  });

  test('scales every kind alike, so native art size decides what looks big', () => {
    // The whole pack is baked from one 16px grid at x4, so a tree's ~136px
    // frame against a mushroom's 64px is exactly the proportion the artist
    // drew. A per-kind scale would silently overrule that.
    const byKind = new Map<string, number[]>();
    for (const i of generateScenery(opts())) {
      const list = byKind.get(i.kind) ?? [];
      list.push(i.scale);
      byKind.set(i.kind, list);
    }
    expect(byKind.size).toBeGreaterThan(1);
    // Kinds with plenty of samples must span the same jitter range; sparse
    // kinds (animals, stumps) can't be expected to hit the extremes,
    // but every one of their items must still fall inside that range.
    const populous = [...byKind.values()].filter((v) => v.length >= 20);
    expect(populous.length).toBeGreaterThan(1);
    const ranges = populous.map((v) => [Math.min(...v), Math.max(...v)]);
    for (const [lo, hi] of ranges) {
      expect(lo).toBeCloseTo(ranges[0]![0]!, 1);
      expect(hi).toBeCloseTo(ranges[0]![1]!, 1);
    }
    const globalLo = Math.min(...ranges.map(([lo]) => lo!));
    const globalHi = Math.max(...ranges.map(([, hi]) => hi!));
    for (const scales of byKind.values()) {
      for (const s of scales) {
        expect(s).toBeGreaterThanOrEqual(globalLo - 0.01);
        expect(s).toBeLessThanOrEqual(globalHi + 0.01);
      }
    }
  });

  test('varies size a little within a kind, so a stand of trees is not stamped', () => {
    const trees = generateScenery(opts()).filter((i) => i.kind === 'tree').map((t) => t.scale);
    expect(new Set(trees).size).toBeGreaterThan(5);
  });

  test('emits only variants that exist for each kind', () => {
    const maxVariant: Record<string, number> = {
      tree: 4, bush: 3, rock: 5, mushroom: 4,
      flower: 3, stump: 2, animal: 5,
    };
    for (const i of generateScenery(opts())) {
      expect(i.variant).toBeGreaterThanOrEqual(1);
      expect(i.variant).toBeLessThanOrEqual(maxVariant[i.kind]!);
      expect(SCENERY_ART_SIZE[`${i.kind}-${i.variant}`]).toBeDefined();
    }
  });

  test('returns back-to-front order so canopies overlap correctly', () => {
    const items = generateScenery(opts());
    for (let i = 1; i < items.length; i++) {
      expect(items[i]!.y).toBeGreaterThanOrEqual(items[i - 1]!.y);
    }
  });

  test('places nothing when every candidate is inside a building', () => {
    // Overhangs the bounds so the sampler's jitter can't land a candidate just
    // past the far edge.
    const items = generateScenery(opts({
      buildings: [{ x: -200, y: -200, w: 1800, h: 1500 }],
    }));
    expect(items).toEqual([]);
  });
});

describe('scenery art sizes', () => {
  test('match the baked textures on disk, so clearances measure what is drawn', () => {
    const dir = join(import.meta.dir, '../../../public/assets/themes/sunnyside/scenery');
    const animated = SUNNYSIDE_SHEET.scenery.animated as Record<
      string, { frameWidth: number; frameHeight: number }
    >;
    for (const [key, [w, h]] of Object.entries(SCENERY_ART_SIZE)) {
      const strip = animated[key];
      const expected = strip !== undefined
        ? [strip.frameWidth, strip.frameHeight]
        : pngSize(join(dir, `${key}.png`));
      expect([key, w, h]).toEqual([key, expected[0]!, expected[1]!]);
    }
  });
});

describe('scenery in the shipped village', () => {
  const village = shippedVillage();
  const items: SceneryItem[] = generateScenery(village.options);

  test('lays a real road network and a real scatter to check', () => {
    expect(village.roads.tiles.length).toBeGreaterThan(80);
    expect(items.length).toBeGreaterThan(300);
  });

  test('no sprite overlaps a drawn road cell', () => {
    const offenders = items.filter((i) => roadCellsUnder(sceneryFootprint(i), village.roads) > 0);
    expect(offenders).toEqual([]);
  });

  test('no sprite overlaps a building sprite', () => {
    const offenders = items.filter((i) => {
      const art = sceneryFootprint(i);
      return village.sprites.some((s) => overlaps(art, s));
    });
    expect(offenders).toEqual([]);
  });

  test('no boulder hugs a building', () => {
    for (const r of items.filter((i) => i.kind === 'rock' && [1, 2, 5].includes(i.variant))) {
      const art = sceneryFootprint(r);
      for (const s of village.sprites) expect(rectGap(art, s)).toBeGreaterThanOrEqual(40);
    }
  });

  test('no scenery sprite is drawn over another', () => {
    // The bug this pins: a stump half-hidden behind a boulder, a bush behind
    // a trunk, a pine's crown across the oak in front of it.
    expect(spriteClashes(items)).toEqual([]);
    expect(trunksHidden(items)).toEqual([]);
  });

  test('no animal spawns inside another sprite', () => {
    expect(animalsInsideSprites(items)).toEqual([]);
  });

  test('woodland stays woodland, not an orchard', () => {
    // Forbidding overlap must not strip the forest: the scatter keeps its
    // trees and its undergrowth.
    expect(items.filter((i) => i.kind === 'tree').length).toBeGreaterThan(250);
    expect(items.filter((i) => i.kind !== 'tree' && i.kind !== 'animal').length)
      .toBeGreaterThan(250);
  });

  test('no sprite stands in the water', () => {
    const offenders = items.filter((i) => {
      const art = sceneryFootprint(i);
      return village.water.some((w) => overlaps(art, w));
    });
    expect(offenders).toEqual([]);
  });
});
