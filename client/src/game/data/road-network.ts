export interface Point {
  x: number;
  y: number;
}

/**
 * Compact organic village waypoints. The interactive map hugs a ~750×550
 * area centred near (1400, 720) — all agents' functional targets are within
 * view at default zoom.
 */
const DEFAULT_WAYPOINTS: Point[] = [
  { x: 1400, y: 1130 }, // 0  gate
  { x: 1400, y: 1000 }, // 1  south-junction
  { x: 1320, y: 790 },  // 2  plaza
  { x: 1430, y: 560 },  // 3  north-junction
  { x: 1130, y: 790 },  // 4  west-junction
  { x: 1680, y: 790 },  // 5  east-junction
  { x: 1150, y: 560 },  // 6  nw-corner
  { x: 1660, y: 560 },  // 7  ne-corner
  { x: 1150, y: 1000 }, // 8  sw-corner
  { x: 1680, y: 1000 }, // 9  se-corner
  { x: 1040, y: 680 },  // 10 library-access
  { x: 1790, y: 680 },  // 11 chapel-access
  { x: 1430, y: 490 },  // 12 castle-access
];

const DEFAULT_EDGES: [number, number][] = [
  // N-S main spine
  [0, 1], [1, 2], [2, 3],
  // E-W through plaza
  [2, 4], [2, 5],
  // Corner diagonals (non-grid feel)
  [1, 8], [1, 9],
  [3, 6], [3, 7],
  [4, 6], [4, 8],
  [5, 7], [5, 9],
  // Short spurs
  [6, 10], [4, 10],
  [7, 11], [5, 11],
  [3, 12],
];

// ---------------------------------------------------------------------------
// Mutable active graph — swapped when a MapConfig is loaded
// ---------------------------------------------------------------------------

function buildAdjacency(waypoints: Point[], edges: [number, number][]): Map<number, number[]> {
  const adj: Map<number, number[]> = new Map();
  for (let i = 0; i < waypoints.length; i++) adj.set(i, []);
  for (const [a, b] of edges) {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  }
  return adj;
}

let activeWaypoints: Point[] = DEFAULT_WAYPOINTS;
let activeEdges: [number, number][] = DEFAULT_EDGES;
let activeAdjacency: Map<number, number[]> = buildAdjacency(DEFAULT_WAYPOINTS, DEFAULT_EDGES);

function setRoadNetwork(waypoints: Point[], edges: [number, number][]): void {
  activeWaypoints = waypoints;
  activeEdges = edges;
  activeAdjacency = buildAdjacency(waypoints, edges);
}

/** Restore the default hardcoded road network (procedural terrain). */
export function resetRoadNetwork(): void {
  setRoadNetwork(DEFAULT_WAYPOINTS, DEFAULT_EDGES);
}

/**
 * Adopt a generated desire-path network as the routing graph.
 *
 * This is what stops heroes clipping through buildings: the generator already
 * routed every track around the footprints, so a hero that only ever walks
 * these waypoints inherits that clearance for free. Falls back to the default
 * graph for an empty network so heroes can always move somewhere.
 */
export function setRoadNetworkFromDesire(
  waypoints: Point[],
  edges: Array<[number, number]>,
): void {
  if (waypoints.length === 0) {
    resetRoadNetwork();
    return;
  }
  setRoadNetwork(waypoints, edges);
}

// ---------------------------------------------------------------------------
// Pathfinding (reads from active graph)
// ---------------------------------------------------------------------------

/** Polyline legs longer than this get subdivided so heroes walk in small steps
 *  instead of teleporting across the whole segment in a single tween. */
const SUBDIVIDE_ABOVE = 40;
/** Target spacing between interpolated waypoints along a long leg. */
const SUBDIVIDE_STEP = 25;

/**
 * Return the points to append after `a` to reach `b`, subdividing the segment
 * into evenly-spaced waypoints when it exceeds SUBDIVIDE_ABOVE. Always ends
 * with `b` itself so the original vertex is preserved.
 */
function interpolateSegment(a: Point, b: Point): Point[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len <= SUBDIVIDE_ABOVE) return [{ x: b.x, y: b.y }];
  const steps = Math.max(2, Math.round(len / SUBDIVIDE_STEP));
  const out: Point[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    out.push({ x: a.x + t * dx, y: a.y + t * dy });
  }
  return out;
}

function dist(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function nearestWaypoint(p: Point): number {
  let best = 0;
  let bestDist = dist(p, activeWaypoints[0]!);
  for (let i = 1; i < activeWaypoints.length; i++) {
    const d = dist(p, activeWaypoints[i]!);
    if (d < bestDist) { best = i; bestDist = d; }
  }
  return best;
}

function bfs(startIdx: number, endIdx: number): number[] {
  if (startIdx === endIdx) return [startIdx];
  const visited = new Set<number>([startIdx]);
  const queue: number[][] = [[startIdx]];
  while (queue.length > 0) {
    const path = queue.shift()!;
    const current = path[path.length - 1]!;
    for (const neighbor of activeAdjacency.get(current) ?? []) {
      if (neighbor === endIdx) return [...path, neighbor];
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([...path, neighbor]);
      }
    }
  }
  return [startIdx, endIdx];
}

export function findRoadPath(from: Point, to: Point): Point[] {
  const startIdx = nearestWaypoint(from);
  const endIdx = nearestWaypoint(to);
  const waypointPath = bfs(startIdx, endIdx);
  const coarse: Point[] = [from];
  for (const idx of waypointPath) {
    const wp = activeWaypoints[idx]!;
    const lastPoint = coarse[coarse.length - 1]!;
    if (dist(lastPoint, wp) > 10) coarse.push(wp);
  }
  const lastCoarse = coarse[coarse.length - 1]!;
  if (dist(lastCoarse, to) > 10) coarse.push(to);

  // Interpolate long legs into short steps so moveAlongPath emits many short
  // tweens instead of one long glide across the whole segment. Graph itself
  // stays coarse — only the path returned to the hero is denser.
  const out: Point[] = [coarse[0]!];
  for (let i = 1; i < coarse.length; i++) {
    for (const step of interpolateSegment(coarse[i - 1]!, coarse[i]!)) {
      out.push(step);
    }
  }
  return out;
}

/** Exposed so TerrainRenderer can paint roads along the same network. */
export function getRoadSegments(): Array<{ a: Point; b: Point; main: boolean }> {
  const mainEdges = new Set(['0-1', '1-2', '2-3']);
  const result: Array<{ a: Point; b: Point; main: boolean }> = [];
  for (const [a, b] of activeEdges) {
    const key = `${Math.min(a, b)}-${Math.max(a, b)}`;
    result.push({ a: activeWaypoints[a]!, b: activeWaypoints[b]!, main: mainEdges.has(key) });
  }
  return result;
}
