import { describe, test, expect } from 'bun:test';
import { waterKeepOut } from './water';
import { generateScenery } from './scenery';
import type { TerrainCell } from './map-config';

const TILE = 64;

function grid(cells: Array<[number, number, string]>): Record<string, TerrainCell> {
  const out: Record<string, TerrainCell> = {};
  for (const [col, row, set] of cells) {
    out[`${col},${row}`] = { tile: { set, frame: 0 }, walkable: true };
  }
  return out;
}

/** A rectangular block of water cells, as the shipped map paints its lake. */
function lake(col0: number, row0: number, cols: number, rows: number): Array<[number, number, string]> {
  const cells: Array<[number, number, string]> = [];
  for (let c = col0; c < col0 + cols; c++) {
    for (let r = row0; r < row0 + rows; r++) cells.push([c, r, 'terrain-water']);
  }
  return cells;
}

describe('waterKeepOut', () => {
  test('collapses a rectangular lake to a single rect', () => {
    const rects = waterKeepOut(grid(lake(0, 23, 34, 6)), TILE);
    expect(rects).toHaveLength(1);
    const r = rects[0]!;
    // Covers the painted cells, plus a shore margin on every side.
    expect(r.x).toBeLessThan(0);
    expect(r.y).toBeLessThan(23 * TILE);
    expect(r.x + r.w).toBeGreaterThan(34 * TILE);
    expect(r.y + r.h).toBeGreaterThan(29 * TILE);
  });

  test('ignores land, and keeps separate bodies of water separate', () => {
    const rects = waterKeepOut(grid([
      ...lake(0, 0, 2, 2),
      ...lake(10, 0, 2, 2),
      [5, 0, 'terrain-color1'],
      [5, 1, 'terrain-color1'],
    ]), TILE);
    expect(rects).toHaveLength(2);
    // Neither rect reaches the land column between them.
    for (const r of rects) {
      expect(r.x <= 5 * TILE && r.x + r.w >= 6 * TILE).toBe(false);
    }
  });

  test('an irregular shore still covers every water cell', () => {
    const cells = [...lake(0, 0, 4, 1), ...lake(0, 1, 2, 1), ...lake(2, 2, 3, 1)];
    const rects = waterKeepOut(grid(cells), TILE);
    for (const [col, row] of cells) {
      const cx = col * TILE + TILE / 2;
      const cy = row * TILE + TILE / 2;
      const covered = rects.some((r) => cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h);
      expect(covered).toBe(true);
    }
  });

  test('is empty for a map with no water', () => {
    expect(waterKeepOut(grid([[0, 0, 'terrain-color1'], [1, 0, 'terrain-color1']]), TILE)).toEqual([]);
  });

  // The bug this module exists for: the lake is terrain tiles rather than a
  // placed feature, so without it the generator plants a forest in the water.
  test('keeps generated scenery out of the water', () => {
    const terrain = grid(lake(0, 12, 20, 6));
    const water = waterKeepOut(terrain, TILE);
    const bounds = { x: 0, y: 0, w: 20 * TILE, h: 20 * TILE };
    const wet = (i: { x: number; y: number }) =>
      i.x >= 0 && i.x <= 20 * TILE && i.y >= 12 * TILE && i.y <= 18 * TILE;

    const before = generateScenery({ bounds, buildings: [], roads: [] });
    expect(before.filter(wet).length).toBeGreaterThan(0);

    const after = generateScenery({ bounds, buildings: [], roads: [], exclusions: water });
    expect(after.filter(wet)).toHaveLength(0);
  });
});
