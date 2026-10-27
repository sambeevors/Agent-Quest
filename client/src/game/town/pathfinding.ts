import { footOf, isWalkable, tileAt, type Point, type Tile } from './town';

/**
 * Four-way grid routing over the town's walkable blocks — how a FireRed
 * character moves: one tile at a time, turning only at right angles, never
 * through a fence, a ledge or the water.
 *
 * Paths are in FEET coordinates (see `footOf`). The returned polyline keeps
 * only the corners, so a hero tweens down a straight street in one leg and
 * turns where the street does.
 */

type WalkableFn = (tx: number, ty: number) => boolean;

const STEPS: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** Bounds the spiral search for the nearest walkable tile. */
const SNAP_RADIUS = 12;

/** The walkable tile nearest a tile (itself, if it's walkable). */
export function nearestWalkable(tile: Tile, walkable: WalkableFn = isWalkable): Tile | null {
  if (walkable(tile[0], tile[1])) return tile;
  for (let r = 1; r <= SNAP_RADIUS; r++) {
    let best: Tile | null = null;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const t: Tile = [tile[0] + dx, tile[1] + dy];
        const d = Math.abs(dx) + Math.abs(dy);
        if (d < bestD && walkable(t[0], t[1])) { best = t; bestD = d; }
      }
    }
    if (best !== null) return best;
  }
  return null;
}

/**
 * Shortest 4-way tile path from `from` to `to`, both inclusive; null when
 * there is none. A* with a Manhattan heuristic, preferring to keep going
 * straight on ties so routes read as streets rather than staircases.
 */
export function findTilePath(from: Tile, to: Tile, walkable: WalkableFn = isWalkable): Tile[] | null {
  const key = (x: number, y: number): number => (y << 16) | x;
  const goal = key(to[0], to[1]);
  const h = (x: number, y: number): number => Math.abs(x - to[0]) + Math.abs(y - to[1]);
  const g = new Map<number, number>([[key(from[0], from[1]), 0]]);
  const came = new Map<number, number>();
  const dirOf = new Map<number, number>();
  // Binary heap of [f, turnPenalty, key].
  const open: Array<[number, number, number]> = [[h(from[0], from[1]), 0, key(from[0], from[1])]];
  const less = (a: [number, number, number], b: [number, number, number]): boolean =>
    a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const push = (item: [number, number, number]): void => {
    open.push(item);
    let i = open.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(open[i]!, open[p]!)) break;
      [open[i], open[p]] = [open[p]!, open[i]!];
      i = p;
    }
  };
  const pop = (): [number, number, number] => {
    const top = open[0]!;
    const last = open.pop()!;
    if (open.length > 0) {
      open[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < open.length && less(open[l]!, open[m]!)) m = l;
        if (r < open.length && less(open[r]!, open[m]!)) m = r;
        if (m === i) break;
        [open[i], open[m]] = [open[m]!, open[i]!];
        i = m;
      }
    }
    return top;
  };

  const closed = new Set<number>();
  while (open.length > 0) {
    const [, , k] = pop();
    if (k === goal) break;
    if (closed.has(k)) continue;
    closed.add(k);
    const x = k & 0xffff;
    const y = k >> 16;
    const gk = g.get(k)!;
    const dir = dirOf.get(k);
    STEPS.forEach(([dx, dy], d) => {
      const nx = x + dx;
      const ny = y + dy;
      if (!walkable(nx, ny)) return;
      const nk = key(nx, ny);
      const ng = gk + 1;
      if (ng >= (g.get(nk) ?? Infinity)) return;
      g.set(nk, ng);
      came.set(nk, k);
      dirOf.set(nk, d);
      push([ng + h(nx, ny), dir === undefined || dir === d ? 0 : 1, nk]);
    });
  }

  if (!g.has(goal)) return null;
  const path: Tile[] = [];
  for (let k: number | undefined = goal; k !== undefined; k = came.get(k)) {
    path.push([k & 0xffff, k >> 16]);
  }
  return path.reverse();
}

/** Drop every tile that isn't a corner (or an end). */
export function corners(path: readonly Tile[]): Tile[] {
  if (path.length <= 2) return [...path];
  const out: Tile[] = [path[0]!];
  for (let i = 1; i < path.length - 1; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const c = path[i + 1]!;
    if (b[0] - a[0] !== c[0] - b[0] || b[1] - a[1] !== c[1] - b[1]) out.push(b);
  }
  out.push(path[path.length - 1]!);
  return out;
}

/**
 * Feet-to-feet walk across town. Starts with `from` itself: a hero caught
 * between tiles (a walk cut short by a new destination) first steps onto
 * its tile, then follows the streets. Falls back to a straight line only if
 * either end is nowhere near walkable ground, so a hero is never stranded.
 */
export function findWalk(from: Point, to: Point, walkable: WalkableFn = isWalkable): Point[] {
  const start = nearestWalkable(tileAt(from), walkable);
  const end = nearestWalkable(tileAt(to), walkable);
  if (start === null || end === null) return [from, to];
  const tiles = findTilePath(start, end, walkable);
  if (tiles === null) return [from, to];
  const out: Point[] = [from];
  const points = corners(tiles).map(footOf);
  // The goal may sit off-centre on its tile (a hero standing on the bridge
  // planks is centred, but callers may ask for any point).
  points[points.length - 1] = to;
  for (const p of points) {
    const last = out[out.length - 1]!;
    if (Math.abs(last.x - p.x) + Math.abs(last.y - p.y) > 0.5) out.push(p);
  }
  // Leaving an off-grid point: square up to the first corner's axis so the
  // first leg is a straight line too.
  if (out.length > 2) {
    const a = out[0]!;
    const b = out[1]!;
    if (a.x !== b.x && a.y !== b.y) out.splice(1, 0, { x: b.x, y: a.y });
  }
  return out;
}
