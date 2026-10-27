import { describe, test, expect } from 'bun:test';
import { shoreTiles, SHORE_FRAME, SHORE_FRAME_COUNT, type ShoreTile } from './shore';
import type { TerrainCell } from './map-config';
import { SUNNYSIDE_SHEET } from '../themes/sunnyside-sheet';

function grid(water: Array<[number, number]>): Record<string, TerrainCell> {
  const out: Record<string, TerrainCell> = {};
  for (const [col, row] of water) {
    out[`${col},${row}`] = { tile: { set: 'terrain-water', frame: 0 }, walkable: true };
  }
  return out;
}

function block(col0: number, row0: number, cols: number, rows: number): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  for (let c = col0; c < col0 + cols; c++) {
    for (let r = row0; r < row0 + rows; r++) cells.push([c, r]);
  }
  return cells;
}

/** Frames drawn at one cell, sorted. */
function at(tiles: ShoreTile[], col: number, row: number): number[] {
  return tiles.filter((t) => t.col === col && t.row === row).map((t) => t.frame).sort();
}

describe('shoreTiles', () => {
  test('matches the baked sheet', () => {
    expect(SUNNYSIDE_SHEET.terrain.shoreFrames).toBe(SHORE_FRAME_COUNT);
  });

  test('is empty for a map with no water', () => {
    const land: Record<string, TerrainCell> = {
      '0,0': { tile: { set: 'terrain-grass', frame: 0 }, walkable: true },
    };
    expect(shoreTiles(land, 10, 10)).toEqual([]);
  });

  test('fringes the land along each straight side of a pond', () => {
    // Pond at cols 3..6, rows 3..5, well inside a 12x12 world.
    const tiles = shoreTiles(grid(block(3, 3, 4, 3)), 12, 12);
    // North shore: the land row above, water to its south.
    for (const c of [4, 5]) expect(at(tiles, c, 2)).toEqual([SHORE_FRAME.edgeS]);
    // South shore.
    for (const c of [4, 5]) expect(at(tiles, c, 6)).toEqual([SHORE_FRAME.edgeN]);
    // West and east shores.
    expect(at(tiles, 2, 4)).toEqual([SHORE_FRAME.edgeE]);
    expect(at(tiles, 7, 4)).toEqual([SHORE_FRAME.edgeW]);
    // Open water and dry land away from the shore draw nothing.
    expect(at(tiles, 5, 4)).toEqual([]);
    expect(at(tiles, 9, 9)).toEqual([]);
  });

  test('cuts every pond corner at 45 degrees instead of squaring it', () => {
    const tiles = shoreTiles(grid(block(3, 3, 4, 3)), 12, 12);
    // Each corner water cell keeps the half that faces the rest of the pond.
    expect(at(tiles, 3, 3)).toEqual([SHORE_FRAME.cutSE]);
    expect(at(tiles, 6, 3)).toEqual([SHORE_FRAME.cutSW]);
    expect(at(tiles, 3, 5)).toEqual([SHORE_FRAME.cutNE]);
    expect(at(tiles, 6, 5)).toEqual([SHORE_FRAME.cutNW]);
    // The land either side of a cut corner has no fringe facing it — the
    // diagonal meets the neighbouring fringes at the tile corners.
    expect(at(tiles, 3, 2)).toEqual([]);
    expect(at(tiles, 2, 3)).toEqual([]);
    // And the land diagonally off a corner touches no water edge at all.
    expect(at(tiles, 2, 2)).toEqual([]);
  });

  test('cuts the land cell in a concave corner of the water', () => {
    // Water filling the world's top-left 8x8 except a 4x4 cape of land in
    // its own top-left — the land's corner pokes into the water at (3,3).
    const water = block(0, 0, 8, 8).filter(([c, r]) => !(c < 4 && r < 4));
    const tiles = shoreTiles(grid(water), 12, 12);
    // The land cell at the inside of the bend becomes half water.
    expect(at(tiles, 3, 3)).toEqual([SHORE_FRAME.cutSE]);
    // Its neighbours along the cape's sides carry plain fringes.
    expect(at(tiles, 3, 2)).toEqual([SHORE_FRAME.edgeE]);
    expect(at(tiles, 2, 3)).toEqual([SHORE_FRAME.edgeS]);
    // The water cells beside the cut stay open water.
    expect(at(tiles, 4, 3)).toEqual([]);
    expect(at(tiles, 3, 4)).toEqual([]);
  });

  test('a strip of land between two waters is fringed on both sides', () => {
    // Water in cols 0..2 and 4..6, land in col 3, rows 0..9 of a 7-wide world.
    const water = [...block(0, 0, 3, 10), ...block(4, 0, 3, 10)];
    const tiles = shoreTiles(grid(water), 7, 10);
    expect(at(tiles, 3, 5)).toEqual([SHORE_FRAME.edgeE, SHORE_FRAME.edgeW].sort());
  });

  test('water running off the world edge grows no shore along the border', () => {
    // The shipped lake: cols 0..33, rows 23..28 of a 44x29-cell world, flush
    // with its west and south edges.
    const tiles = shoreTiles(grid(block(0, 23, 34, 6)), 44, 29);
    // No corner cut where the lake meets the border...
    expect(at(tiles, 0, 23)).toEqual([]);
    expect(at(tiles, 0, 28)).toEqual([]);
    expect(at(tiles, 33, 28)).toEqual([]);
    // ...only at its one real corner, out in the meadow.
    expect(at(tiles, 33, 23)).toEqual([SHORE_FRAME.cutSW]);
    // Its north shore runs right up to the border, its east shore right down.
    expect(at(tiles, 0, 22)).toEqual([SHORE_FRAME.edgeS]);
    expect(at(tiles, 32, 22)).toEqual([SHORE_FRAME.edgeS]);
    expect(at(tiles, 34, 24)).toEqual([SHORE_FRAME.edgeW]);
    expect(at(tiles, 34, 28)).toEqual([SHORE_FRAME.edgeW]);
    // Nothing is drawn outside the world.
    expect(tiles.every((t) => t.col >= 0 && t.row >= 0 && t.col < 44 && t.row < 29)).toBe(true);
    // Every piece is a real frame.
    expect(tiles.every((t) => t.frame >= 0 && t.frame < SHORE_FRAME_COUNT)).toBe(true);
  });
});
