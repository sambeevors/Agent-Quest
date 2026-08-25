import { describe, test, expect } from 'bun:test';
import { buildPathTilemap, makeTileable, rasterisePaths, tileFrame } from './path-tiles';
import type { DesireNetwork, Point } from './desire-paths';

const COLUMNS = 6;
const BLOCK = 0;

const key = (col: number, row: number): number => (col + 4096) * 16384 + (row + 4096);

function net(roads: Array<{ points: Point[]; traffic: number }>): DesireNetwork {
  return {
    roads: roads.map((r, i) => ({ a: `a${i}`, b: `b${i}`, ...r })),
    waypoints: [],
    edges: [],
  };
}

/** Every marked cell reachable from the first by orthogonal steps? */
function isConnected(marked: Set<number>): boolean {
  const first = [...marked][0];
  if (first === undefined) return true;
  const seen = new Set<number>([first]);
  const queue = [first];
  while (queue.length > 0) {
    const k = queue.pop()!;
    const col = Math.floor(k / 16384) - 4096;
    const row = (k % 16384) - 4096;
    for (const [c, r] of [[col - 1, row], [col + 1, row], [col, row - 1], [col, row + 1]] as const) {
      const nk = key(c, r);
      if (marked.has(nk) && !seen.has(nk)) { seen.add(nk); queue.push(nk); }
    }
  }
  return seen.size === marked.size;
}

describe('tileFrame', () => {
  test('picks the interior tile when every neighbour is road', () => {
    // Row 1, col 1 of the block — the seamless fill.
    expect(tileFrame(true, true, true, true, BLOCK, COLUMNS)).toBe(BLOCK + COLUMNS + 1);
  });

  test('exposes the side that has no neighbour', () => {
    // Nothing to the left → the tile carrying a left border (block column 0).
    expect(tileFrame(false, true, true, true, BLOCK, COLUMNS)).toBe(BLOCK + COLUMNS + 0);
    // Nothing to the right → block column 2.
    expect(tileFrame(true, false, true, true, BLOCK, COLUMNS)).toBe(BLOCK + COLUMNS + 2);
    // Nothing above → block row 0.
    expect(tileFrame(true, true, false, true, BLOCK, COLUMNS)).toBe(BLOCK + 1);
    // Nothing below → block row 2.
    expect(tileFrame(true, true, true, false, BLOCK, COLUMNS)).toBe(BLOCK + COLUMNS * 2 + 1);
  });

  test('uses the narrow-strip tiles when both opposing sides are open', () => {
    // A one-cell-wide vertical run: left and right both exposed → column 3.
    expect(tileFrame(false, false, true, true, BLOCK, COLUMNS)).toBe(BLOCK + COLUMNS + 3);
    // A lone cell: every side exposed → the fully rounded tile.
    expect(tileFrame(false, false, false, false, BLOCK, COLUMNS)).toBe(BLOCK + COLUMNS * 3 + 3);
  });

  test('corner tiles combine both exposed sides', () => {
    // Open above and to the left → the block's top-left corner.
    expect(tileFrame(false, true, false, true, BLOCK, COLUMNS)).toBe(BLOCK);
  });
});

describe('rasterisePaths', () => {
  test('covers the cells a straight track runs through', () => {
    const marked = rasterisePaths(
      [{ points: [{ x: 100, y: 100 }, { x: 400, y: 100 }], traffic: 0 }],
      32, 10, 22,
    );
    expect(marked.has(key(Math.floor(100 / 32), Math.floor(100 / 32)))).toBe(true);
    expect(marked.has(key(Math.floor(250 / 32), Math.floor(100 / 32)))).toBe(true);
    expect(marked.has(key(Math.floor(400 / 32), Math.floor(100 / 32)))).toBe(true);
  });

  test('a busier track is wider than a quiet one', () => {
    const line: Point[] = [{ x: 100, y: 100 }, { x: 500, y: 100 }];
    const quiet = rasterisePaths([{ points: line, traffic: 0 }], 32, 22, 38);
    const busy = rasterisePaths([{ points: line, traffic: 1 }], 32, 22, 38);
    expect(busy.size).toBeGreaterThan(quiet.size);
  });

  test('marks a contiguous band, even where the track runs along cell edges', () => {
    // Threaded exactly along cell boundaries is the worst case: every sample
    // sits equidistant from four cell centres.
    const marked = rasterisePaths(
      [{ points: [{ x: 32, y: 32 }, { x: 320, y: 320 }], traffic: 0 }],
      32, 10, 22,
    );
    expect(marked.size).toBeGreaterThan(8);
  });
});

describe('makeTileable', () => {
  test('carries the surface through a corner touch', () => {
    const marked = new Set<number>([key(0, 0), key(1, 1)]);
    makeTileable(marked);
    expect(isConnected(marked)).toBe(true);
  });

  test('closes a diagonal track that rasterises to a chain of corner touches', () => {
    // A track at 45 degrees is the case that forces this: its band is narrower
    // than a cell diagonal, so the cells it marks only ever touch at corners
    // and the road would come out as beads.
    const cells: Array<[number, number]> = [];
    for (let i = 0; i < 12; i++) cells.push([i, i]);
    const marked = new Set(cells.map(([c, r]) => key(c, r)));
    makeTileable(marked);
    expect(isConnected(marked)).toBe(true);
  });

  test('fills a pinhole the road has closed around', () => {
    const cells: Array<[number, number]> = [[1, 0], [0, 1], [2, 1], [1, 2]];
    const marked = new Set(cells.map(([c, r]) => key(c, r)));
    makeTileable(marked);
    expect(marked.has(key(1, 1))).toBe(true);
  });

  test('leaves an honest inner corner alone', () => {
    // Two sides road, two sides grass — a track turning a sharp corner. There
    // is no tile for the notch, and none is needed.
    const marked = new Set<number>([key(0, 0), key(0, 1), key(0, 2), key(1, 2), key(2, 2)]);
    const before = marked.size;
    makeTileable(marked);
    expect(marked.size).toBe(before);
  });

  test('leaves a straight run alone', () => {
    const marked = new Set<number>([key(0, 0), key(1, 0), key(2, 0)]);
    makeTileable(marked);
    expect(marked.size).toBe(3);
  });

  test('does not flood the ground a loop of roads encloses', () => {
    // A ring of tracks around an open green. Closing every concave corner and
    // iterating would swallow the middle; the middle is the point.
    const marked = new Set<number>();
    for (let i = 0; i <= 12; i++) {
      marked.add(key(i, 0));
      marked.add(key(i, 12));
      marked.add(key(0, i));
      marked.add(key(12, i));
    }
    makeTileable(marked);
    expect(marked.has(key(6, 6))).toBe(false);
    expect(marked.size).toBeLessThan(60);
  });
});

describe('buildPathTilemap', () => {
  const network = net([
    { points: [{ x: 200, y: 200 }, { x: 600, y: 200 }], traffic: 1 },
    { points: [{ x: 600, y: 200 }, { x: 600, y: 560 }], traffic: 0.2 },
  ]);

  test('emits a tile per covered cell, all with real block frames', () => {
    const map = buildPathTilemap(network);
    expect(map.tiles.length).toBeGreaterThan(20);
    // Every frame must land inside the 4×4 edge block — never on the gravel
    // or tuft column, which share the sheet.
    for (const f of new Set(map.tiles.map((t) => t.frame))) {
      expect(f % COLUMNS).toBeLessThanOrEqual(3);
      expect(Math.floor(f / COLUMNS)).toBeLessThanOrEqual(3);
    }
  });

  test('each tile agrees with its own neighbours', () => {
    const map = buildPathTilemap(network);
    const present = new Set(map.tiles.map((t) => key(t.col, t.row)));
    for (const t of map.tiles) {
      const expected = tileFrame(
        present.has(key(t.col - 1, t.row)),
        present.has(key(t.col + 1, t.row)),
        present.has(key(t.col, t.row - 1)),
        present.has(key(t.col, t.row + 1)),
        BLOCK, COLUMNS,
      );
      expect(t.frame).toBe(expected);
    }
  });

  test('leaves no road cell stranded from the rest of a connected network', () => {
    const map = buildPathTilemap(net([
      { points: [{ x: 60, y: 60 }, { x: 700, y: 560 }], traffic: 0 },
    ]));
    expect(isConnected(new Set(map.tiles.map((t) => key(t.col, t.row))))).toBe(true);
  });

  test('is deterministic', () => {
    expect(buildPathTilemap(network)).toEqual(buildPathTilemap(network));
  });

  test('clips to the supplied bounds', () => {
    const map = buildPathTilemap(network, { bounds: { x: 0, y: 0, w: 400, h: 400 } });
    expect(map.tiles.length).toBeGreaterThan(0);
    for (const t of map.tiles) {
      expect(t.col * 32).toBeLessThan(400);
      expect(t.row * 32).toBeLessThan(400);
    }
  });

  test('puts gravel only on the surface and tufts only off it', () => {
    const map = buildPathTilemap(network);
    const road = new Set(map.tiles.map((t) => key(t.col, t.row)));
    expect(map.accents.length).toBeGreaterThan(0);
    for (const a of map.accents) {
      const onRoad = road.has(key(Math.floor(a.x / 32), Math.floor(a.y / 32)));
      if (a.frame === 4) expect(onRoad).toBe(true);
      else expect(onRoad).toBe(false);
    }
  });

  test('returns nothing for an empty network', () => {
    const map = buildPathTilemap(net([]));
    expect(map.tiles).toEqual([]);
    expect(map.accents).toEqual([]);
  });
});
