import type { Rect } from './desire-paths';
import { TILE_SIZE, type TerrainCell } from './map-config';

/**
 * Keep-out ground derived from the water painted into the map's terrain grid.
 *
 * The scenery generator already refuses to spawn inside a placed feature, but
 * a *tile* is not a feature: the lake along the south of the village is 204
 * cells of `terrain-water` in `MapConfig.terrain`, and nothing in the shipped
 * map describes it as an obstacle — `TerrainCell.walkable` is `true` on every
 * one of them. Without this the generator treats the lake as ordinary ground
 * and grows a forest out of it.
 *
 * Rects are merged rather than emitted one per tile so the generator's
 * per-candidate scan stays over a handful of shapes instead of hundreds.
 */

/**
 * How far back from the waterline scenery is pushed, px.
 *
 * Items are anchored at the point where they meet the ground, so a tree
 * standing exactly on the last land tile is already legal — but its trunk is
 * wider than the anchor, and it reads as growing out of the shallows. One tile
 * of beach is enough to keep the whole trunk dry.
 */
const SHORE_MARGIN = 24;

/** True for any tileset that paints open water. */
function isWaterTile(set: string): boolean {
  return set.includes('water');
}

/**
 * Merge the water cells of a terrain grid into a small set of world-space
 * rects, inflated by the shore margin.
 */
export function waterKeepOut(
  terrain: Readonly<Record<string, TerrainCell>>,
  tileSize: number = TILE_SIZE,
): Rect[] {
  // Water cells bucketed by row, so each row can be swept into runs.
  const rows = new Map<number, Set<number>>();
  for (const [key, cell] of Object.entries(terrain)) {
    if (!isWaterTile(cell.tile.set)) continue;
    const [colStr, rowStr] = key.split(',');
    if (colStr === undefined || rowStr === undefined) continue;
    const col = parseInt(colStr, 10);
    const row = parseInt(rowStr, 10);
    if (!Number.isFinite(col) || !Number.isFinite(row)) continue;
    let cols = rows.get(row);
    if (cols === undefined) { cols = new Set(); rows.set(row, cols); }
    cols.add(col);
  }

  // Horizontal runs per row, in row order.
  interface Run { row: number; from: number; to: number }
  const runs: Run[] = [];
  for (const row of [...rows.keys()].sort((a, b) => a - b)) {
    const cols = [...rows.get(row)!].sort((a, b) => a - b);
    let from = cols[0]!;
    let prev = from;
    for (let i = 1; i < cols.length; i++) {
      const col = cols[i]!;
      if (col !== prev + 1) {
        runs.push({ row, from, to: prev });
        from = col;
      }
      prev = col;
    }
    runs.push({ row, from, to: prev });
  }

  // Grow each run downward while the row below repeats it exactly, which
  // collapses a rectangular lake to a single rect.
  const open = new Map<string, { from: number; to: number; top: number; bottom: number }>();
  const boxes: Array<{ from: number; to: number; top: number; bottom: number }> = [];
  for (const run of runs) {
    const key = `${run.from},${run.to}`;
    const above = open.get(key);
    if (above !== undefined && above.bottom === run.row - 1) {
      above.bottom = run.row;
      continue;
    }
    const box = { from: run.from, to: run.to, top: run.row, bottom: run.row };
    open.set(key, box);
    boxes.push(box);
  }

  return boxes.map((b) => ({
    x: b.from * tileSize - SHORE_MARGIN,
    y: b.top * tileSize - SHORE_MARGIN,
    w: (b.to - b.from + 1) * tileSize + SHORE_MARGIN * 2,
    h: (b.bottom - b.top + 1) * tileSize + SHORE_MARGIN * 2,
  }));
}
