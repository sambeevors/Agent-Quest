import type { Point, Rect } from './desire-paths';

/**
 * Procedural scatter for the world's natural clutter — trees, shrubs, rocks,
 * mushrooms.
 *
 * Two things drive the design:
 *
 *   - **Nothing lands where it shouldn't.** Every candidate is rejected if it
 *     falls near a building or a road. Hand-placed scenery drifts out of date
 *     the moment a building moves or a track reroutes; generating it against
 *     the current layout means the map can never end up with a tree growing
 *     through a wall or a boulder in the middle of a lane.
 *   - **It has to look grown, not sprinkled.** Uniform random scatter reads as
 *     noise. Density here follows a low-frequency field so woodland clumps and
 *     thins the way real woodland does, and thins out again near the
 *     settlements so the villages sit in their own clearings.
 *
 * The whole thing is seeded and pure, so the same world always produces the
 * same forest — scenery that reshuffles on every reload is disorienting.
 */

export type SceneryKind = 'tree' | 'bush' | 'rock' | 'mushroom';

export interface SceneryItem {
  kind: SceneryKind;
  /** 1-based texture variant, e.g. 3 → `tree-3`. */
  variant: number;
  x: number;
  y: number;
  scale: number;
  flipX: boolean;
}

interface KindSpec {
  /** How many texture variants exist for this kind. */
  variants: number;
  /** Relative likelihood in dense woodland vs. open ground. */
  weightDense: number;
  weightOpen: number;
  /** Clearance from a building footprint, px. */
  buildingClearance: number;
  /** Clearance from the centre-line of a road, px. */
  roadClearance: number;
  /** Minimum gap between two items of this kind, px. */
  spacing: number;
}

/**
 * World scale for scenery art. One value for every kind, because the pack draws
 * all of it to one scale: measured on the artwork rather than the frame, a tree
 * is 174px tall, a bush 42 and a mushroom 19. Rendering all three at
 * `SCENERY_SCALE` is what makes the tree nine times the mushroom, as drawn. The
 * per-kind scales this replaces did the opposite — bushes were inflated by 60%
 * against the trees, so a shrub read as a sapling.
 *
 * The value is the old tree scale, so the thing that dominates the view is
 * unchanged and everything else falls into its true place beside it.
 *
 * It is NOT the scale buildings use, and can't be: the buildings under
 * `BuildingsCustom/` are drawn at roughly twice this pack's pixel density (a
 * tavern there is 273px tall where Tiny Swords' own house is 148), so one
 * number cannot serve both. See `buildingScale` in the theme.
 */
const SCENERY_SCALE = 0.55;

/** Per-item size variation, so a stand of trees isn't stamped from one mould. */
const SCALE_JITTER = 0.15;

/**
 * Per-kind placement rules — how much room each kind needs, and how likely it
 * is to appear. Size is deliberately not among them; see `SCENERY_SCALE`.
 *
 * Trees are the big offenders: their canopy is several times the size of their
 * trunk, so they need real distance from anything. Small props are allowed
 * close to a road edge, which is exactly where they look best.
 */
const KIND_SPECS: Record<SceneryKind, KindSpec> = {
  tree: {
    variants: 4, weightDense: 70, weightOpen: 8,
    buildingClearance: 46, roadClearance: 52, spacing: 54,
  },
  bush: {
    variants: 3, weightDense: 14, weightOpen: 34,
    buildingClearance: 26, roadClearance: 30, spacing: 44,
  },
  rock: {
    variants: 5, weightDense: 10, weightOpen: 34,
    buildingClearance: 24, roadClearance: 26, spacing: 46,
  },
  mushroom: {
    variants: 3, weightDense: 6, weightOpen: 24,
    buildingClearance: 20, roadClearance: 22, spacing: 38,
  },
};

export interface SceneryOptions {
  bounds: Rect;
  /** Building footprints — nothing spawns on or beside one. */
  buildings: readonly Rect[];
  /** Road polylines — nothing spawns on or beside one. */
  roads: ReadonlyArray<readonly Point[]>;
  /** Extra reserved ground (water, plazas, anything hand-placed). */
  exclusions?: readonly Rect[];
  /** Sampling interval. Smaller = denser candidate set. Default 44px. */
  cell?: number;
  /** Overall scale on the density field. Default 1. */
  density?: number;
  seed?: number;
}

/** Small deterministic PRNG — same seed, same forest, every reload. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Low-frequency field in 0..1 deciding how thick the woodland is at a point.
 * Several sine octaves rather than true Perlin — cheaper, and at this scale
 * indistinguishable once trees are drawn over it.
 */
function woodlandDensity(x: number, y: number): number {
  const n =
    Math.sin(x * 0.0037 + 1.3) * 0.5 +
    Math.cos(y * 0.0041 - 0.7) * 0.5 +
    Math.sin((x + y) * 0.0023 + 2.1) * 0.35 +
    Math.cos((x - y) * 0.0031 - 1.9) * 0.3;
  // Biased upward: at 0.5 the map read as a mown field with the odd shrub.
  // Woodland should be the default state of ground nobody has cleared.
  return Math.min(1, Math.max(0, (n + 1.65) / 3.3) * 0.55 + 0.45);
}

/** Distance from a point to a rect, 0 when inside. */
function distToRect(p: Point, r: Rect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

/** Distance from a point to a segment. */
function distToSegment(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lenSq = vx * vx + vy * vy;
  if (lenSq < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

/**
 * Buckets road segments by grid cell so a candidate only tests the handful of
 * segments near it. Without this, every candidate would be measured against
 * every segment of every road — hundreds of thousands of comparisons for a
 * result that is always "nowhere near it".
 */
class SegmentIndex {
  private readonly cells = new Map<string, Array<[Point, Point]>>();
  private readonly cellSize: number;

  constructor(roads: ReadonlyArray<readonly Point[]>, cellSize: number) {
    this.cellSize = cellSize;
    for (const road of roads) {
      for (let i = 1; i < road.length; i++) {
        const a = road[i - 1]!;
        const b = road[i]!;
        const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
        const minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
        for (let cx = Math.floor(minX / cellSize); cx <= Math.floor(maxX / cellSize); cx++) {
          for (let cy = Math.floor(minY / cellSize); cy <= Math.floor(maxY / cellSize); cy++) {
            const key = `${cx},${cy}`;
            let list = this.cells.get(key);
            if (list === undefined) { list = []; this.cells.set(key, list); }
            list.push([a, b]);
          }
        }
      }
    }
  }

  /** Shortest distance from p to any road, searching only nearby cells. */
  distance(p: Point, radius: number): number {
    const reach = Math.ceil(radius / this.cellSize);
    const cx = Math.floor(p.x / this.cellSize);
    const cy = Math.floor(p.y / this.cellSize);
    let best = Infinity;
    for (let i = cx - reach; i <= cx + reach; i++) {
      for (let j = cy - reach; j <= cy + reach; j++) {
        for (const [a, b] of this.cells.get(`${i},${j}`) ?? []) {
          const d = distToSegment(p, a, b);
          if (d < best) best = d;
        }
      }
    }
    return best;
  }
}

/** Spatial hash for the minimum-spacing check between placed items. */
class PlacedIndex {
  private readonly cells = new Map<string, Point[]>();
  private readonly cellSize: number;

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  tooClose(p: Point, minDist: number): boolean {
    const reach = Math.ceil(minDist / this.cellSize);
    const cx = Math.floor(p.x / this.cellSize);
    const cy = Math.floor(p.y / this.cellSize);
    for (let i = cx - reach; i <= cx + reach; i++) {
      for (let j = cy - reach; j <= cy + reach; j++) {
        for (const q of this.cells.get(`${i},${j}`) ?? []) {
          if (Math.hypot(p.x - q.x, p.y - q.y) < minDist) return true;
        }
      }
    }
    return false;
  }

  add(p: Point): void {
    const key = `${Math.floor(p.x / this.cellSize)},${Math.floor(p.y / this.cellSize)}`;
    let list = this.cells.get(key);
    if (list === undefined) { list = []; this.cells.set(key, list); }
    list.push(p);
  }
}

export function generateScenery(opts: SceneryOptions): SceneryItem[] {
  const cell = opts.cell ?? 44;
  const density = opts.density ?? 1;
  const rng = mulberry32(opts.seed ?? 0x5eed);
  const exclusions = opts.exclusions ?? [];

  const roadIndex = new SegmentIndex(opts.roads, 96);
  const placed: Record<SceneryKind, PlacedIndex> = {
    tree: new PlacedIndex(96),
    bush: new PlacedIndex(96),
    rock: new PlacedIndex(96),
    mushroom: new PlacedIndex(96),
  };
  const items: SceneryItem[] = [];

  const kinds = Object.keys(KIND_SPECS) as SceneryKind[];
  const maxBuildingClearance = Math.max(...kinds.map((k) => KIND_SPECS[k].buildingClearance));

  for (let gx = opts.bounds.x; gx < opts.bounds.x + opts.bounds.w; gx += cell) {
    for (let gy = opts.bounds.y; gy < opts.bounds.y + opts.bounds.h; gy += cell) {
      const p: Point = { x: gx + rng() * cell, y: gy + rng() * cell };

      let inExclusion = false;
      for (const r of exclusions) {
        if (distToRect(p, r) <= 0) { inExclusion = true; break; }
      }
      if (inExclusion) continue;

      // Nearest building governs both rejection and how open the ground feels.
      let nearestBuilding = Infinity;
      for (const r of opts.buildings) {
        const d = distToRect(p, r);
        if (d < nearestBuilding) nearestBuilding = d;
      }
      if (nearestBuilding < maxBuildingClearance * 0.5) continue; // right against a wall

      // Thin the woodland as it approaches a settlement, so villages sit in
      // their own clearing without needing a hard-edged exclusion zone.
      const openness = Math.min(1, nearestBuilding / 300);
      const field = woodlandDensity(p.x, p.y) * (0.25 + 0.75 * openness);
      if (rng() > field * density) continue;

      // Dense ground favours trees; open ground favours low props.
      const denseness = Math.min(1, field * 1.4);
      const weights = kinds.map((k) => {
        const spec = KIND_SPECS[k];
        return spec.weightOpen + (spec.weightDense - spec.weightOpen) * denseness;
      });
      const total = weights.reduce((a, b) => a + b, 0);
      let roll = rng() * total;
      let kind: SceneryKind = kinds[0]!;
      for (let i = 0; i < kinds.length; i++) {
        roll -= weights[i]!;
        if (roll <= 0) { kind = kinds[i]!; break; }
      }

      const spec = KIND_SPECS[kind];
      if (nearestBuilding < spec.buildingClearance) continue;
      if (roadIndex.distance(p, spec.roadClearance) < spec.roadClearance) continue;
      if (placed[kind].tooClose(p, spec.spacing)) continue;

      placed[kind].add(p);
      items.push({
        kind,
        variant: 1 + Math.floor(rng() * spec.variants),
        x: p.x,
        y: p.y,
        scale: SCENERY_SCALE * (1 + (rng() * 2 - 1) * SCALE_JITTER),
        flipX: rng() < 0.5,
      });
    }
  }

  // Painter's order: draw back to front so canopies overlap correctly.
  items.sort((a, b) => a.y - b.y);
  return items;
}
