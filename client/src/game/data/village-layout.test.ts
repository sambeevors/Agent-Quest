import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { planRoads, spriteRect, doorApproach, roadClearance, doorLead, type RoadSite } from './building-plan';
import { buildDesireNetwork, type Point, type Rect } from './desire-paths';
import { buildPathTilemap, drawnRoadReach, type PathTilemap } from './path-tiles';
import { WORLD_WIDTH, WORLD_HEIGHT } from './building-layout';
import { waterKeepOut } from './water';
import type { TerrainCell } from './map-config';
import { SUNNYSIDE_SHEET } from '../themes/sunnyside-sheet';
import { sunnysideTheme } from '../themes/sunnyside';

/**
 * The shipped village's layout, checked without Phaser: buildings stand
 * clear of each other, and the generated roads never run under a wall.
 */

/** Least clear grass between any two structures' sprites, world px. */
const MIN_BUILDING_GAP = 48;
/** Hero station spacing at a door — mirrors `GRID_SPACING_*` in VillageScene. */
const STATION_X = 68;
const STATION_Y = 36;

const CELL = sunnysideTheme.terrain!.tileSize / 2;
const WORLD: Rect = { x: 0, y: 0, w: WORLD_WIDTH, h: WORLD_HEIGHT };

interface ShippedMap {
  buildings: Array<{ id: string; x: number; y: number }>;
  spawn: Point;
  terrain: Record<string, TerrainCell>;
}

const map = JSON.parse(
  readFileSync(join(import.meta.dir, '../../../../server/data/map/village.json'), 'utf8'),
) as ShippedMap;

/** The activity buildings as the scene spawns them — door 5px below the ground line. */
function buildingSites(): RoadSite[] {
  const sizes = SUNNYSIDE_SHEET.buildings.size as Record<string, readonly [number, number]>;
  return map.buildings.map((b) => {
    const [w, h] = sizes[b.id]!;
    const scale = sunnysideTheme.getBuildingScale(b.id);
    return { id: `b:${b.id}`, door: { x: b.x, y: b.y + 5 }, keepOut: spriteRect(b.x, b.y, w * scale, h * scale) };
  });
}

function rectGap(a: Rect, b: Rect): number {
  const dx = Math.max(b.x - (a.x + a.w), 0, a.x - (b.x + b.w));
  const dy = Math.max(b.y - (a.y + a.h), 0, a.y - (b.y + b.h));
  return Math.hypot(dx, dy);
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function contains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

function intersection(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return { x, y, w: Math.min(a.x + a.w, b.x + b.w) - x, h: Math.min(a.y + a.h, b.y + b.h) - y };
}

function crowdedPairs(sites: readonly RoadSite[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < sites.length; i++) {
    for (let j = i + 1; j < sites.length; j++) {
      const gap = rectGap(sites[i]!.keepOut, sites[j]!.keepOut);
      if (gap < MIN_BUILDING_GAP) out.push(`${sites[i]!.id} / ${sites[j]!.id}: ${gap.toFixed(1)}px`);
    }
  }
  return out;
}

function roads(sites: readonly RoadSite[]): { tilemap: PathTilemap; roadIds: Set<string> } {
  const plan = planRoads(sites, map.spawn, CELL);
  const network = buildDesireNetwork(plan.nodes, plan.obstacles, { clearance: plan.clearance });
  const tilemap = buildPathTilemap(network, { cell: CELL, bounds: WORLD });
  return { tilemap, roadIds: new Set(network.roads.flatMap((r) => [r.a, r.b])) };
}

/**
 * Every drawn road cell that touches a structure's sprite anywhere but its
 * own doorstep.
 */
function roadUnderWalls(sites: readonly RoadSite[]): string[] {
  const { tilemap } = roads(sites);
  const out: string[] = [];
  for (const t of tilemap.tiles) {
    const tile = { x: t.col * CELL, y: t.row * CELL, w: CELL, h: CELL };
    for (const s of sites) {
      if (!overlaps(tile, s.keepOut)) continue;
      // Only the part of the tile that lies over the sprite matters.
      if (contains(doorApproach(s, CELL), intersection(tile, s.keepOut))) continue;
      out.push(`${s.id} under tile ${t.col},${t.row}`);
    }
  }
  return out;
}

describe('shipped village layout', () => {
  test('no two buildings stand closer than the minimum gap', () => {
    expect(crowdedPairs(buildingSites())).toEqual([]);
  });

  test('every building stands inside the world, its labels included', () => {
    const LABEL_HEADROOM = 40;
    for (const s of buildingSites()) {
      const r = s.keepOut;
      expect(contains(WORLD, { x: r.x, y: r.y - LABEL_HEADROOM, w: r.w, h: r.h + LABEL_HEADROOM })).toBe(true);
    }
  });

  test('no building stands in or against the lake, or on the jetty', () => {
    const water = waterKeepOut(map.terrain);
    expect(water.length).toBeGreaterThan(0);
    for (const s of buildingSites()) {
      for (const w of water) expect(rectGap(s.keepOut, w)).toBeGreaterThan(MIN_BUILDING_GAP);
      // The gate's lead runs north off the jetty; a building there would
      // stand on the village's front door.
      expect(rectGap(s.keepOut, { x: map.spawn.x - CELL, y: map.spawn.y - 4 * CELL, w: 2 * CELL, h: 4 * CELL }))
        .toBeGreaterThan(roadClearance(CELL));
    }
  });

  test('every door has a forecourt for a crowd of heroes and its lead', () => {
    // Nine heroes stand 3×3 at the door; the lead runs below them.
    const sites = buildingSites();
    const clearance = roadClearance(CELL);
    for (const s of sites) {
      const lead = doorLead(s, clearance);
      const forecourt: Rect = {
        x: s.door.x - STATION_X * 1.5,
        y: s.door.y,
        w: STATION_X * 3,
        h: Math.max(STATION_Y * 3, lead.y - s.door.y),
      };
      for (const other of sites) {
        if (other === s) continue;
        expect(overlaps(forecourt, other.keepOut)).toBe(false);
      }
    }
  });
});

describe('roads on the shipped village', () => {
  test('no drawn road tile runs under a building, except at its own door', () => {
    expect(roadUnderWalls(buildingSites())).toEqual([]);
  });

  test('every door is still reached by a road', () => {
    const sites = buildingSites();
    const { roadIds, tilemap } = roads(sites);
    for (const s of sites) {
      expect(roadIds.has(s.id)).toBe(true);
      // ...and the road is actually drawn at the doorstep.
      const doorCell = { col: Math.floor(s.door.x / CELL), row: Math.floor(s.door.y / CELL) };
      expect(tilemap.tiles.some((t) => t.col === doorCell.col && t.row === doorCell.row)).toBe(true);
    }
  });

  test('the clearance covers the drawn road, not just its centreline', () => {
    // The routed centreline keeps `clearance` from a wall; its tiles reach
    // `drawnRoadReach` beyond it and its wobble a few px more.
    expect(roadClearance(CELL)).toBeGreaterThan(drawnRoadReach(CELL));
  });
});
