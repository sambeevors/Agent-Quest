import type { TerrainCell } from './map-config';

/**
 * Where the lake meets the meadow, derived from the terrain grid.
 *
 * The shipped map paints its lake as a block of `terrain-water` cells and says
 * nothing about the shore, so left alone water meets grass along a ruler edge.
 * This works out which shoreline piece each cell along that boundary needs,
 * from the same tiles `water.ts` reads — so the shore follows the water if
 * the water ever changes shape.
 *
 * The pieces are the pack's River autotile, baked into `terrain/shore.png`
 * (frame order fixed by SHORE_ORDER in scripts/bake-sunnyside/terrain.py):
 *
 * - **Edges** are grass-fringe decals drawn on a LAND cell, along the side
 *   that faces water. A land cell with water on two sides gets two of them.
 * - **Diagonals** replace a whole cell with a half-grass, half-water tile split
 *   corner to corner. The pack never draws a square pond corner — every
 *   corner of its ponds is cut at 45° — so any cell with one terrain on two
 *   adjacent sides and the other terrain on the remaining two is cut that way:
 *   a water cell on a convex corner of the lake, or a land cell in a concave
 *   one. An edge never faces a cut cell; the cut's diagonal meets the
 *   neighbouring fringes exactly at the tile corners.
 *
 * Cells beyond the world grid count as whatever the nearest in-world cell
 * is, so water running off the edge of the map just keeps going rather than
 * growing a shore along the world border.
 */

/** Frame indices into `terrain/shore.png`. */
export const SHORE_FRAME = {
  /** Fringe decals — water lies on this side of the land cell. */
  edgeN: 0,
  edgeE: 1,
  edgeS: 2,
  edgeW: 3,
  /** Opaque diagonals — water fills this corner half of the cell. */
  cutNW: 4,
  cutNE: 5,
  cutSW: 6,
  cutSE: 7,
} as const;

export const SHORE_FRAME_COUNT = 8;

export interface ShoreTile {
  col: number;
  row: number;
  frame: number;
}

/** True for any tileset that paints open water — same rule as `water.ts`. */
function isWaterTile(set: string): boolean {
  return set.includes('water');
}

/**
 * Shore pieces for a terrain grid, in draw order (cuts before the edges that
 * lie over plain grass — the two never share a cell, so order only matters
 * for determinism).
 *
 * `cols` / `rows` are the world's size in cells; lookups outside it clamp.
 */
export function shoreTiles(
  terrain: Readonly<Record<string, TerrainCell>>,
  cols: number,
  rows: number,
): ShoreTile[] {
  const water = new Set<string>();
  for (const [key, cell] of Object.entries(terrain)) {
    if (isWaterTile(cell.tile.set)) water.add(key);
  }
  if (water.size === 0) return [];

  const clamp = (v: number, max: number): number => Math.min(Math.max(v, 0), max - 1);
  const wet = (c: number, r: number): boolean => water.has(`${clamp(c, cols)},${clamp(r, rows)}`);

  /**
   * The corner half to cut a cell into, or null. A cell is cut when two
   * ADJACENT neighbours are water and the other two are not — "water to the
   * south and east" means the water half is the south-east one. The rule is
   * the same for a water cell (whose two dry sides make it a lake corner) and
   * a land cell (whose two wet sides make it an inlet).
   */
  const cutOf = (c: number, r: number): number | null => {
    const n = wet(c, r - 1);
    const e = wet(c + 1, r);
    const s = wet(c, r + 1);
    const w = wet(c - 1, r);
    if (s && e && !n && !w) return SHORE_FRAME.cutSE;
    if (s && w && !n && !e) return SHORE_FRAME.cutSW;
    if (n && e && !s && !w) return SHORE_FRAME.cutNE;
    if (n && w && !s && !e) return SHORE_FRAME.cutNW;
    return null;
  };

  // Only cells next to water can need anything; gather them once.
  const candidates = new Map<string, [number, number]>();
  for (const key of water) {
    const [c, r] = key.split(',').map(Number) as [number, number];
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        candidates.set(`${nc},${nr}`, [nc, nr]);
      }
    }
  }
  const ordered = [...candidates.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);

  const cut = new Map<string, number>();
  for (const [c, r] of ordered) {
    const frame = cutOf(c, r);
    if (frame !== null) cut.set(`${c},${r}`, frame);
  }

  const out: ShoreTile[] = [];
  for (const [c, r] of ordered) {
    const key = `${c},${r}`;
    const frame = cut.get(key);
    if (frame !== undefined) {
      out.push({ col: c, row: r, frame });
      continue;
    }
    if (wet(c, r)) continue; // open water: nothing to draw

    // A land cell: fringe every side that faces uncut water.
    const faces = (nc: number, nr: number): boolean =>
      wet(nc, nr) && !cut.has(`${clamp(nc, cols)},${clamp(nr, rows)}`);
    if (faces(c, r - 1)) out.push({ col: c, row: r, frame: SHORE_FRAME.edgeN });
    if (faces(c + 1, r)) out.push({ col: c, row: r, frame: SHORE_FRAME.edgeE });
    if (faces(c, r + 1)) out.push({ col: c, row: r, frame: SHORE_FRAME.edgeS });
    if (faces(c - 1, r)) out.push({ col: c, row: r, frame: SHORE_FRAME.edgeW });
  }
  return out;
}
