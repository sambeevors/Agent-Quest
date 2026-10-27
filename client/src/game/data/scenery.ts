import type { Point, Rect } from './desire-paths';

/**
 * Procedural scatter for the world's natural clutter — trees, shrubs, rocks,
 * mushrooms.
 *
 * Two things drive the design:
 *
 *   - **Nothing lands where it shouldn't.** Every candidate is rejected if its
 *     sprite would overlap a building, a road or reserved ground. Hand-placed
 *     scenery drifts out of date the moment a building moves or a track
 *     reroutes; generating it against the current layout means the map can
 *     never end up with a tree growing through a wall or a boulder in the
 *     middle of a lane. Nor may one scenery sprite be drawn over another
 *     (`sceneryClear`), so nothing in the wood hides behind anything else.
 *   - **It has to look grown, not sprinkled.** Uniform random scatter reads as
 *     noise. Density here follows a low-frequency field so woodland clumps and
 *     thins the way real woodland does, and thins out again near the
 *     settlements so the villages sit in their own clearings.
 *
 * The whole thing is seeded and pure, so the same world always produces the
 * same forest — scenery that reshuffles on every reload is disorienting.
 */

export type SceneryKind =
  | 'tree' | 'bush' | 'rock' | 'mushroom'
  | 'flower' | 'stump' | 'animal';

export interface SceneryItem {
  kind: SceneryKind;
  /** 1-based texture variant, e.g. 3 → `tree-3`. */
  variant: number;
  x: number;
  y: number;
  scale: number;
  flipX: boolean;
}

interface VariantSpec {
  /** Relative likelihood of this variant within its kind. */
  weight: number;
  /** Overrides the kind's `roadGap` / `wallGap` for this variant. */
  roadGap?: number;
  wallGap?: number;
}

interface KindSpec {
  /** One entry per texture variant, in variant order (index 0 → `kind-1`). */
  variants: readonly VariantSpec[];
  /** Relative likelihood in dense woodland vs. open ground. */
  weightDense: number;
  weightOpen: number;
  /**
   * Grass left between the item's drawn sprite and the drawn road surface, px.
   * Edge to edge — sprite rect to road cell — never centre to centre-line.
   */
  roadGap: number;
  /** Grass left between the item's drawn sprite and any building's, px. */
  wallGap: number;
  /** Minimum gap between two items of this kind, px (centre to centre). */
  spacing: number;
}

/**
 * World scale for scenery art. One value for every kind, because the bake
 * upscales the whole pack from one 16px grid (x4, nearest-neighbour), so the
 * artwork's own proportions are already correct: a Sunnyside tree is drawn
 * ~34px to a mushroom's ~12, and rendering both at `SCENERY_SCALE` keeps that
 * ratio. Per-kind scales would re-introduce the bug this replaced, where a
 * shrub read as a sapling.
 *
 * The value puts a tree at ~2.5x hero height, which is the proportion the
 * pack's own example scenes use.
 */
export const SCENERY_SCALE = 0.45;

/** Per-item size variation, so a stand of trees isn't stamped from one mould. */
export const SCALE_JITTER = 0.15;

/**
 * Native frame size, [w, h] in baked px, of every scenery texture — what
 * `SceneryRenderer` draws, and so what every clearance is measured against.
 * Static kinds are the PNG's own size; animals are one frame of their strip
 * (`SUNNYSIDE_SHEET.scenery.animated`). `scenery.test.ts` reads the PNGs on
 * disk and fails if this drifts from a re-bake.
 *
 * A table rather than the loaded textures so the generator stays pure: the
 * same numbers drive the game and the tests that pin placement.
 */
export const SCENERY_ART_SIZE: Readonly<Record<string, readonly [number, number]>> = {
  'tree-1': [128, 136], 'tree-2': [112, 172], 'tree-3': [128, 136], 'tree-4': [112, 172],
  'bush-1': [60, 52], 'bush-2': [52, 40], 'bush-3': [32, 40],
  'rock-1': [104, 100], 'rock-2': [96, 88], 'rock-3': [72, 64], 'rock-4': [40, 40],
  'rock-5': [104, 100],
  'mushroom-1': [64, 64], 'mushroom-2': [64, 64], 'mushroom-3': [64, 64], 'mushroom-4': [64, 64],
  'flower-1': [44, 44], 'flower-2': [44, 44], 'flower-3': [48, 48],
  'stump-1': [64, 56], 'stump-2': [64, 56],
  'animal-1': [128, 128], 'animal-2': [128, 128], 'animal-3': [128, 128], 'animal-4': [128, 128],
  'animal-5': [64, 64],
};

/**
 * The sizing in force. Defaults to the Sunnyside numbers above; a theme whose
 * art is drawn to another grid (Pokémon: tile art at x2, never jittered or
 * mirrored) swaps it in once, before the world is generated, with
 * `setSceneryStyle`. Module state rather than a parameter so every helper —
 * footprints, trunk bands, the clearance test — measures the same art.
 */
export interface SceneryStyle {
  scale: number;
  jitter: number;
  artSize: Readonly<Record<string, readonly [number, number]>>;
  flip: boolean;
  /** Multiplier on the density field (a tidy town wants less clutter). */
  density?: number;
}

const DEFAULT_STYLE: SceneryStyle = {
  scale: SCENERY_SCALE,
  jitter: SCALE_JITTER,
  artSize: SCENERY_ART_SIZE,
  flip: true,
};

let style: SceneryStyle = DEFAULT_STYLE;

export function setSceneryStyle(next: SceneryStyle | undefined): void {
  style = next ?? DEFAULT_STYLE;
}

const evenly = (n: number): VariantSpec[] => Array.from({ length: n }, () => ({ weight: 1 }));

/**
 * Per-kind placement rules — how much room each kind needs, and how likely it
 * is to appear. Size is deliberately not among them; see `SCENERY_SCALE`. The
 * gaps sit on top of the sprite's own extent (`SCENERY_ART_SIZE`), so a big
 * sprite automatically keeps further back than a small one.
 *
 * Rocks are weighted per variant. Three of the five (1, 2, 5) are boulders as
 * wide as a tree; drawn as often as the pebbles they turned the meadow into a
 * quarry, and wedged against a wall or a verge they read as rubble nobody
 * cleared. So boulders are rare and keep well back from both — a boulder
 * belongs out in open grass, a pebble can sit at the roadside.
 */
const KIND_SPECS: Record<SceneryKind, KindSpec> = {
  tree: {
    variants: evenly(4), weightDense: 70, weightOpen: 8,
    roadGap: 6, wallGap: 12, spacing: 40,
  },
  bush: {
    variants: evenly(3), weightDense: 14, weightOpen: 30,
    roadGap: 4, wallGap: 8, spacing: 44,
  },
  rock: {
    variants: [
      { weight: 1, roadGap: 28, wallGap: 48 }, // boulder
      { weight: 2, roadGap: 24, wallGap: 40 }, // boulder
      { weight: 4 },
      { weight: 7 },
      { weight: 1, roadGap: 28, wallGap: 48 }, // boulder
    ],
    weightDense: 8, weightOpen: 16,
    roadGap: 8, wallGap: 16, spacing: 64,
  },
  mushroom: {
    variants: evenly(4), weightDense: 6, weightOpen: 20,
    roadGap: 4, wallGap: 8, spacing: 38,
  },
  // The cozy-farm layer. Flowers behave like small props; the rest are
  // deliberately sparse so they read as ambience, not as state: a stump is a
  // rare accent and animals graze alone in open meadow. (Crops used to
  // scatter here too, but stray squares of farmland in the wild read as
  // meaning something — cultivation now lives only inside the Farm.)
  flower: {
    variants: evenly(3), weightDense: 4, weightOpen: 26,
    roadGap: 2, wallGap: 6, spacing: 30,
  },
  stump: {
    variants: evenly(2), weightDense: 6, weightOpen: 4,
    roadGap: 6, wallGap: 12, spacing: 90,
  },
  animal: {
    variants: evenly(5), weightDense: 1, weightOpen: 8,
    roadGap: 16, wallGap: 32, spacing: 240,
  },
};

/** The drawn road surface: the cells `buildPathTilemap` laid a tile in. */
export interface RoadSurface {
  /** World px per cell. */
  cell: number;
  tiles: ReadonlyArray<{ col: number; row: number }>;
}

export interface SceneryOptions {
  bounds: Rect;
  /**
   * Building ground plans (the routing footprints). They decide how open the
   * ground feels, and no sprite may overlap one.
   */
  buildings: readonly Rect[];
  /**
   * Each building's drawn sprite rect — roof, eaves and all. No scenery sprite
   * may come within its kind's `wallGap` of one. Without it only the ground
   * plans are kept clear, which lets a canopy grow through a roof.
   */
  buildingSprites?: readonly Rect[];
  /**
   * The road surface as drawn — the tilemap `buildPathTilemap` produced — so
   * the ground scenery keeps off is exactly the ground that is dirt. Testing
   * against the routing centre-lines instead is what let boulders sit on the
   * verge: the drawn track is up to a cell wider than any half-width.
   */
  roads: RoadSurface;
  /** Extra reserved ground (water, plazas, anything hand-placed). */
  exclusions?: readonly Rect[];
  /** Sampling interval. Smaller = denser candidate set. Default 44px. */
  cell?: number;
  /** Overall scale on the density field. Default 1. */
  density?: number;
  seed?: number;
}

/**
 * The world rect an item's sprite covers, as `SceneryRenderer` draws it:
 * bottom-centre origin, native frame size times the item's scale. A flip is
 * about the centre line, so it doesn't move the rect.
 */
export function sceneryFootprint(
  item: Pick<SceneryItem, 'kind' | 'variant' | 'x' | 'y' | 'scale'>,
): Rect {
  const [fw, fh] = style.artSize[`${item.kind}-${item.variant}`] ?? [64, 64];
  const w = fw * item.scale;
  const h = fh * item.scale;
  return { x: item.x - w / 2, y: item.y - h, w, h };
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

/** Do two rects overlap once `a` is grown by `gap` on every side? */
function rectsOverlap(a: Rect, b: Rect, gap: number): boolean {
  return a.x - gap < b.x + b.w && a.x + a.w + gap > b.x
    && a.y - gap < b.y + b.h && a.y + a.h + gap > b.y;
}

/** Road cells in a set, so a sprite rect only tests the handful it covers. */
class RoadCells {
  private readonly cells = new Set<string>();
  private readonly cell: number;

  constructor(surface: RoadSurface) {
    this.cell = surface.cell;
    for (const t of surface.tiles) this.cells.add(`${t.col},${t.row}`);
  }

  /** Does `r`, grown by `gap`, touch any road cell? Cells are half-open squares. */
  touches(r: Rect, gap: number): boolean {
    const c0 = Math.floor((r.x - gap) / this.cell);
    const c1 = Math.ceil((r.x + r.w + gap) / this.cell) - 1;
    const r0 = Math.floor((r.y - gap) / this.cell);
    const r1 = Math.ceil((r.y + r.h + gap) / this.cell) - 1;
    for (let c = c0; c <= c1; c++) {
      for (let row = r0; row <= r1; row++) {
        if (this.cells.has(`${c},${row}`)) return true;
      }
    }
    return false;
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

/**
 * Grass left between any two scenery sprites, px, edge to edge. Small: the
 * point is that no sprite is drawn over another, not to open up a lawn.
 */
export const SCENERY_GAP = 4;

/**
 * A tree's trunk and roots, as a share of its drawn rect: the bottom `h` of
 * the sprite, the middle `w` of its width. Both tree shapes in the pack keep
 * them inside that band (the round tree's crown ends ~35% up its frame, and
 * its roots span ~45% of its width). The ground shadow either side is left
 * out on purpose — a neighbour's crown may fall across it, which is how
 * crowns get to interlock at all.
 */
const TRUNK_BAND = { w: 0.45, h: 0.36 } as const;

type Placement = Pick<SceneryItem, 'kind' | 'variant' | 'x' | 'y' | 'scale'>;

/** The world rect a tree's trunk and shadow cover — see `TRUNK_BAND`. */
export function treeBase(item: Placement): Rect {
  const r = sceneryFootprint(item);
  const w = r.w * TRUNK_BAND.w;
  const h = r.h * TRUNK_BAND.h;
  return { x: item.x - w / 2, y: item.y - h, w, h };
}

/**
 * May sprites `a` and `b` stand where they are? The single owner of the rule
 * that keeps scenery from being drawn over other scenery.
 *
 * Every pair needs `gap` of grass between their whole drawn rects, with one
 * exception: two trees may interlock crowns, so long as neither sprite
 * reaches the other's trunk band. That is what woodland looks like — crowns
 * meeting overhead, every trunk still standing visibly on the ground — and
 * without it the forest thins to an orchard planted on a grid. Nothing else
 * gets the exception: a stump, bush or pebble half-hidden by a canopy reads
 * as a mistake, not as depth.
 */
export function sceneryClear(a: Placement, b: Placement, gap = SCENERY_GAP): boolean {
  const ra = sceneryFootprint(a);
  const rb = sceneryFootprint(b);
  if (!rectsOverlap(ra, rb, gap)) return true;
  if (a.kind !== 'tree' || b.kind !== 'tree') return false;
  return !rectsOverlap(ra, treeBase(b), gap) && !rectsOverlap(rb, treeBase(a), gap);
}

/**
 * Placed items bucketed by drawn rect, so the cross-kind clearance test only
 * visits sprites near the candidate — the village places ~900 items, and a
 * pairwise test against all of them would be quadratic.
 */
class SpriteIndex {
  private readonly cells = new Map<string, SceneryItem[]>();
  private readonly cellSize: number;

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  /** Bucket range [c0, c1, r0, r1] covered by `r` grown by `pad`. */
  private span(r: Rect, pad: number): [number, number, number, number] {
    const s = this.cellSize;
    return [
      Math.floor((r.x - pad) / s), Math.floor((r.x + r.w + pad) / s),
      Math.floor((r.y - pad) / s), Math.floor((r.y + r.h + pad) / s),
    ];
  }

  /** Is `item` clear of every indexed item (see `sceneryClear`)? */
  clear(item: SceneryItem): boolean {
    const [c0, c1, r0, r1] = this.span(sceneryFootprint(item), SCENERY_GAP);
    for (let c = c0; c <= c1; c++) {
      for (let r = r0; r <= r1; r++) {
        for (const other of this.cells.get(`${c},${r}`) ?? []) {
          if (!sceneryClear(item, other)) return false;
        }
      }
    }
    return true;
  }

  add(item: SceneryItem): void {
    const [c0, c1, r0, r1] = this.span(sceneryFootprint(item), 0);
    for (let c = c0; c <= c1; c++) {
      for (let r = r0; r <= r1; r++) {
        const key = `${c},${r}`;
        let list = this.cells.get(key);
        if (list === undefined) { list = []; this.cells.set(key, list); }
        list.push(item);
      }
    }
  }
}

/**
 * Spots within its cell a rolled item may try before the cell is left empty.
 * Without the retries, every candidate that grazed a neighbour's sprite was
 * simply dropped, and the woodland thinned to an orchard once sprites were
 * forbidden to overlap.
 */
const SPOT_ATTEMPTS = 6;

/** Weighted pick from `weights` with a single roll in [0, 1). */
function pickWeighted(weights: readonly number[], roll: number): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = roll * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

export function generateScenery(opts: SceneryOptions): SceneryItem[] {
  const cell = opts.cell ?? 44;
  const density = (opts.density ?? 1) * (style.density ?? 1);
  const rng = mulberry32(opts.seed ?? 0x5eed);
  const exclusions = opts.exclusions ?? [];
  const walls = [...opts.buildings, ...(opts.buildingSprites ?? [])];

  const roadCells = new RoadCells(opts.roads);
  const kinds = Object.keys(KIND_SPECS) as SceneryKind[];
  const placed = Object.fromEntries(
    kinds.map((k) => [k, new PlacedIndex(96)]),
  ) as Record<SceneryKind, PlacedIndex>;
  const sprites = new SpriteIndex(128);
  const items: SceneryItem[] = [];

  for (let gx = opts.bounds.x; gx < opts.bounds.x + opts.bounds.w; gx += cell) {
    for (let gy = opts.bounds.y; gy < opts.bounds.y + opts.bounds.h; gy += cell) {
      const p: Point = { x: gx + rng() * cell, y: gy + rng() * cell };

      // Cheap point test first; the sprite-rect test below is the real one.
      let inExclusion = false;
      for (const r of exclusions) {
        if (distToRect(p, r) <= 0) { inExclusion = true; break; }
      }
      if (inExclusion) continue;

      // Nearest building governs how open the ground feels.
      let nearestBuilding = Infinity;
      for (const r of opts.buildings) {
        const d = distToRect(p, r);
        if (d < nearestBuilding) nearestBuilding = d;
      }

      // Thin the woodland as it approaches a settlement, so villages sit in
      // their own clearing without needing a hard-edged exclusion zone.
      const openness = Math.min(1, nearestBuilding / 300);
      const field = woodlandDensity(p.x, p.y) * (0.25 + 0.75 * openness);
      if (rng() > field * density) continue;

      // Dense ground favours trees; open ground favours low props.
      const denseness = Math.min(1, field * 1.4);
      const kind = kinds[pickWeighted(kinds.map((k) => {
        const spec = KIND_SPECS[k];
        return spec.weightOpen + (spec.weightDense - spec.weightOpen) * denseness;
      }), rng())]!;
      const spec = KIND_SPECS[kind];
      const v = pickWeighted(spec.variants.map((s) => s.weight), rng());
      const variantSpec = spec.variants[v]!;
      const scale = style.scale * (1 + (rng() * 2 - 1) * style.jitter);
      const flipX = rng() < 0.5 && style.flip;

      const wallGap = variantSpec.wallGap ?? spec.wallGap;
      const roadGap = variantSpec.roadGap ?? spec.roadGap;

      // The cell has rolled an item; offer it a few spots within the cell, so
      // one unlucky roll against a neighbour doesn't leave a hole in the wood.
      // Everything is measured on the sprite as it will be drawn, so a
      // boulder twice a pebble's width keeps twice as far back on its own.
      for (let attempt = 0; attempt < SPOT_ATTEMPTS; attempt++) {
        const at = attempt === 0 ? p : { x: gx + rng() * cell, y: gy + rng() * cell };
        if (exclusions.some((r) => distToRect(at, r) <= 0)) continue;
        const item: SceneryItem = { kind, variant: v + 1, x: at.x, y: at.y, scale, flipX };
        const art = sceneryFootprint(item);
        if (walls.some((w) => rectsOverlap(art, w, wallGap))) continue;
        if (exclusions.some((r) => rectsOverlap(art, r, 0))) continue;
        if (roadCells.touches(art, roadGap)) continue;
        if (placed[kind].tooClose(at, spec.spacing)) continue;
        // No sprite drawn over another, whatever their kinds. Animals wander
        // off their spawn point, so only the spawn can be checked — but it is
        // checked both ways: no sheep spawns inside a bush, nothing grows on
        // a sheep.
        if (!sprites.clear(item)) continue;

        placed[kind].add(at);
        sprites.add(item);
        items.push(item);
        break;
      }
    }
  }

  // Painter's order: draw back to front so canopies overlap correctly.
  items.sort((a, b) => a.y - b.y);
  return items;
}
