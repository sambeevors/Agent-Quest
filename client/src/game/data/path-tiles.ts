import type { DesireNetwork, Point, Rect } from './desire-paths';

/**
 * Turns a generated desire-path network into tiles from the terrain tileset.
 *
 * The previous renderer painted tracks with stamped discs of brown. It read as
 * a shape laid *on* the map rather than part of it, because everything else in
 * the world is hand-drawn art with a chunky dark outline and this was flat
 * vector fill. Nothing procedural was going to match that outline.
 *
 * So this doesn't try. The ground tileset already contains a second surface —
 * a packed-earth block laid out as a 4×4 set of edge tiles, drawn by the same
 * artist with the same border as the grass. A road is simply that surface
 * showing through where the grass has been worn away, which is how these tiles
 * were always meant to be used:
 *
 *   1. Rasterise each track onto a grid, wider where foot traffic is heavier.
 *   2. Close the holes and pinch points rasterising leaves behind.
 *   3. Pick each cell's tile from which of its four neighbours are also road.
 *
 * The edges then come from the artwork rather than from code, and a track
 * meets the grass exactly the way the lake and the cliffs do.
 *
 * Pure — no Phaser — so the tiling is unit-testable.
 */

export interface PathTile {
  col: number;
  row: number;
  /** Frame index into the terrain tileset. */
  frame: number;
}

/** A scattered detail sprite — grass at the verge, gravel on the surface. */
export interface PathAccent {
  /** World-space centre. */
  x: number;
  y: number;
  frame: number;
  flipX: boolean;
}

export interface PathTilemap {
  /** World px per grid cell — also the size each tile renders at. */
  cell: number;
  tiles: PathTile[];
  accents: PathAccent[];
}

export interface PathTileOptions {
  /** Grid resolution in world px. Default 32 (half a source tile). */
  cell?: number;
  /** Half-width of the least- and most-travelled track, world px. */
  minHalfWidth?: number;
  maxHalfWidth?: number;
  /** Columns in the road tileset. Default 6. */
  tilesetColumns?: number;
  /**
   * Frame index of the top-left tile of the 4×4 road-surface block. Rows run
   * top-edge / middle / bottom-edge / both; columns left / middle / right /
   * both.
   */
  roadBlockFrame?: number;
  /** Tileset frame holding grass tufts, sprinkled along the verge. */
  tuftFrame?: number;
  /** Tileset frame holding loose gravel, sprinkled on the surface. */
  gravelFrame?: number;
  /** World rect tiles are clipped to. */
  bounds?: Rect;
  seed?: number;
}

const DEFAULTS = {
  cell: 32,
  minHalfWidth: 10,
  maxHalfWidth: 22,
  tilesetColumns: 6,
  roadBlockFrame: 0,
  gravelFrame: 4,
  tuftFrame: 5,
  seed: 0x0ad,
} as const;

/** Chance an eligible cell gets a detail sprite. Sparse on purpose — these are
 * accents, and a dot in every cell would read as a pattern. */
const GRAVEL_CHANCE = 0.1;
const TUFT_CHANCE = 0.16;

/** Deterministic [0, 1) from a cell coordinate plus a salt. */
function noise(col: number, row: number, salt: number): number {
  const s = Math.sin(col * 127.1 + row * 311.7 + salt * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

const key = (col: number, row: number): number => (col + 4096) * 16384 + (row + 4096);

const decodeKey = (k: number): [number, number] => [
  Math.floor(k / 16384) - 4096,
  (k % 16384) - 4096,
];

// ---------------------------------------------------------------------------
// Rasterisation
// ---------------------------------------------------------------------------

/**
 * Mark every cell a track covers.
 *
 * Each track is walked in sub-cell steps and, at every step, the cells whose
 * centre falls within the track's half-width are marked. The cell containing
 * the step itself is marked unconditionally: a sample sitting near a cell
 * corner can be further from that cell's centre than the half-width, and
 * skipping it would punch a hole straight through the middle of a road.
 */
export function rasterisePaths(
  roads: ReadonlyArray<{ points: readonly Point[]; traffic: number }>,
  cell: number,
  minHalfWidth: number,
  maxHalfWidth: number,
): Set<number> {
  const marked = new Set<number>();

  for (const road of roads) {
    const t = Math.min(1, Math.max(0, road.traffic));
    const half = minHalfWidth + (maxHalfWidth - minHalfWidth) * t;
    const step = Math.min(cell / 2, half / 2);
    const reach = Math.ceil(half / cell) + 1;

    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1]!;
      const b = road.points[i]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.ceil(len / step));

      for (let s = 0; s <= steps; s++) {
        const f = s / steps;
        const px = a.x + (b.x - a.x) * f;
        const py = a.y + (b.y - a.y) * f;
        const cx = Math.floor(px / cell);
        const cy = Math.floor(py / cell);
        marked.add(key(cx, cy));

        for (let c = cx - reach; c <= cx + reach; c++) {
          for (let r = cy - reach; r <= cy + reach; r++) {
            const dx = (c + 0.5) * cell - px;
            const dy = (r + 0.5) * cell - py;
            if (dx * dx + dy * dy <= half * half) marked.add(key(c, r));
          }
        }
      }
    }
  }

  return marked;
}

/**
 * Tidy the grid into a shape that reads as road.
 *
 * Two defects are worth repairing, and only two. Both are local, which is the
 * point: an earlier version closed every concave notch and iterated until
 * nothing changed, which is a morphological closing — it ate the grass out of
 * every space the network enclosed and turned the village into one sand plaza.
 *
 *   - **Pinholes.** A cell left bare with road on three or four sides reads as
 *     a hole punched in the surface, not as grass. Filled.
 *   - **Corner touches.** Two cells meeting only at a diagonal share no edge,
 *     so each is drawn as though the other were not there and the track
 *     visibly pinches shut. Both remaining cells of the block are filled,
 *     carrying the surface through the turn. A diagonal track rasterises to a
 *     chain of exactly these, so without this it would come out as beads.
 *
 * An honest inner corner — two sides road, two sides grass — is left alone.
 * There is no tile for it in a 16-tile edge set, but none is needed: the tiles
 * around it draw their own borders, so it reads as a track turning sharply,
 * which is what it is.
 *
 * Both rules can expose a new instance next door, so each runs to a fixpoint.
 * Both are bounded: they only fill cells adjacent to existing road, and only
 * where the surrounding road already nearly encloses them.
 */
export function makeTileable(marked: Set<number>): void {
  const neighbours = (c: number, r: number): Array<[number, number]> =>
    [[c - 1, r], [c + 1, r], [c, r - 1], [c, r + 1]];

  const candidates = (): Set<number> => {
    const out = new Set<number>();
    for (const k of marked) {
      const [col, row] = decodeKey(k);
      for (const [c, r] of neighbours(col, row)) {
        const nk = key(c, r);
        if (!marked.has(nk)) out.add(nk);
      }
    }
    return out;
  };

  for (let pass = 0; pass < 4; pass++) {
    let changed = false;

    // Pinholes: bare cells the road already surrounds on three sides or more.
    for (const k of candidates()) {
      const [col, row] = decodeKey(k);
      const filled = neighbours(col, row).filter(([c, r]) => marked.has(key(c, r))).length;
      if (filled >= 3) { marked.add(k); changed = true; }
    }

    // Corner touches, checked over every 2x2 block that borders the road.
    for (const k of [...marked]) {
      const [col, row] = decodeKey(k);
      for (const [oc, or] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as const) {
        const c = col + oc;
        const r = row + or;
        const tl = marked.has(key(c, r));
        const tr = marked.has(key(c + 1, r));
        const bl = marked.has(key(c, r + 1));
        const br = marked.has(key(c + 1, r + 1));
        if (tl === br && tr === bl && tl !== tr) {
          if (tl) { marked.add(key(c + 1, r)); marked.add(key(c, r + 1)); }
          else { marked.add(key(c, r)); marked.add(key(c + 1, r + 1)); }
          changed = true;
        }
      }
    }

    if (!changed) return;
  }
}

// ---------------------------------------------------------------------------
// Autotiling
// ---------------------------------------------------------------------------

/**
 * Index into a 4×4 edge block from which of the two opposing neighbours exist.
 * 0 = only the "after" side is road, so this edge is exposed; 1 = both, an
 * interior tile; 2 = only "before"; 3 = neither, a one-cell-wide strip.
 */
function edgeIndex(before: boolean, after: boolean): number {
  if (before && after) return 1;
  if (before) return 2;
  if (after) return 0;
  return 3;
}

/** Tile frame for one road cell, given its four orthogonal neighbours. */
export function tileFrame(
  left: boolean, right: boolean, up: boolean, down: boolean,
  roadBlockFrame: number, tilesetColumns: number,
): number {
  return roadBlockFrame
    + edgeIndex(up, down) * tilesetColumns
    + edgeIndex(left, right);
}

// ---------------------------------------------------------------------------

export function buildPathTilemap(network: DesireNetwork, opts: PathTileOptions = {}): PathTilemap {
  const cell = opts.cell ?? DEFAULTS.cell;
  const minHalfWidth = opts.minHalfWidth ?? DEFAULTS.minHalfWidth;
  const maxHalfWidth = opts.maxHalfWidth ?? DEFAULTS.maxHalfWidth;
  const columns = opts.tilesetColumns ?? DEFAULTS.tilesetColumns;
  const roadBlockFrame = opts.roadBlockFrame ?? DEFAULTS.roadBlockFrame;
  const tuftFrame = opts.tuftFrame ?? DEFAULTS.tuftFrame;
  const gravelFrame = opts.gravelFrame ?? DEFAULTS.gravelFrame;
  const seed = opts.seed ?? DEFAULTS.seed;

  const marked = rasterisePaths(network.roads, cell, minHalfWidth, maxHalfWidth);
  makeTileable(marked);

  const bounds = opts.bounds;
  const inBounds = (col: number, row: number): boolean => {
    if (bounds === undefined) return true;
    const x = col * cell;
    const y = row * cell;
    return x + cell > bounds.x && x < bounds.x + bounds.w
      && y + cell > bounds.y && y < bounds.y + bounds.h;
  };

  const has = (col: number, row: number): boolean => marked.has(key(col, row));

  const tiles: PathTile[] = [];
  const accents: PathAccent[] = [];
  const verge = new Set<number>();

  for (const k of marked) {
    const [col, row] = decodeKey(k);
    if (!inBounds(col, row)) continue;

    const left = has(col - 1, row);
    const right = has(col + 1, row);
    const up = has(col, row - 1);
    const down = has(col, row + 1);
    tiles.push({ col, row, frame: tileFrame(left, right, up, down, roadBlockFrame, columns) });

    // Gravel only on interior cells — on an edge cell it would sit on the
    // tile's transparent margin and appear to float on the grass.
    if (left && right && up && down && noise(col, row, seed) < GRAVEL_CHANCE) {
      accents.push({
        x: (col + 0.5) * cell + (noise(col, row, seed + 1) - 0.5) * cell * 0.5,
        y: (row + 0.5) * cell + (noise(col, row, seed + 2) - 0.5) * cell * 0.5,
        frame: gravelFrame,
        flipX: noise(col, row, seed + 3) < 0.5,
      });
    }

    for (const [nc, nr] of [[col - 1, row], [col + 1, row], [col, row - 1], [col, row + 1]] as const) {
      if (!has(nc, nr) && inBounds(nc, nr)) verge.add(key(nc, nr));
    }
  }

  // Tufts of grass on the cells just off the road, softening the join.
  for (const k of verge) {
    const [col, row] = decodeKey(k);
    if (noise(col, row, seed + 4) >= TUFT_CHANCE) continue;
    accents.push({
      x: (col + 0.5) * cell + (noise(col, row, seed + 5) - 0.5) * cell * 0.6,
      y: (row + 0.5) * cell + (noise(col, row, seed + 6) - 0.5) * cell * 0.6,
      frame: tuftFrame,
      flipX: noise(col, row, seed + 7) < 0.5,
    });
  }

  // Stable order so a rebuild draws identically.
  tiles.sort((a, b) => (a.row - b.row) || (a.col - b.col));
  accents.sort((a, b) => (a.y - b.y) || (a.x - b.x));

  return { cell, tiles, accents };
}
