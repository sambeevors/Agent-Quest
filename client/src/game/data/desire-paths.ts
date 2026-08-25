/**
 * Desire-path road generation.
 *
 * Replaces hand-drawn, rigid roads with tracks derived from where people
 * actually want to walk. The model follows how real desire paths form:
 *
 *   1. Every pair of destinations that plausibly want a direct link gets one.
 *      Not all pairs — that's spaghetti. We take the Euclidean minimum
 *      spanning tree (guarantees the village is connected by the shortest
 *      total length) and add the Gabriel-graph edges on top, which contribute
 *      the short local shortcuts that give a village its loops.
 *   2. Nobody walks through a wall. Each link is routed through a small
 *      visibility graph built from the buildings' inflated footprint corners,
 *      so a track bends around a building rather than crossing it. This is
 *      also what keeps heroes from clipping: the routing graph the heroes walk
 *      IS the road network.
 *   3. Tracks widen with use. Edge betweenness over the link graph stands in
 *      for foot traffic — a route that many journeys funnel through is worn
 *      broad, a spur to one building stays narrow.
 *   4. Nothing is perfectly straight. Interior points get a small deterministic
 *      offset, seeded from the coordinates, so the same map always produces the
 *      same wobble instead of shimmering on every re-render.
 *
 * Everything here is pure — no Phaser — so the geometry is unit-testable.
 */

export interface Point {
  x: number;
  y: number;
}

/** Axis-aligned obstacle in world space, expressed by its top-left corner. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A destination tracks connect — normally a building's door. */
export interface DesireNode {
  id: string;
  x: number;
  y: number;
}

export interface DesireRoad {
  /** Node ids this track runs between. */
  a: string;
  b: string;
  /** Polyline in world space, including both endpoints. */
  points: Point[];
  /** Normalised foot traffic, 0..1. Drives rendered width. */
  traffic: number;
}

export interface DesireNetwork {
  roads: DesireRoad[];
  /** Flattened routing graph: every polyline vertex, deduped. */
  waypoints: Point[];
  /** Index pairs into `waypoints`. */
  edges: Array<[number, number]>;
}

export interface DesireOptions {
  /** How far tracks keep clear of a building footprint. Default 26px. */
  clearance?: number;
  /** Maximum sideways wobble applied to interior points. Default 6px. */
  jitter?: number;
  /** Spacing between generated interior points along a leg. Default 34px. */
  step?: number;
  /**
   * Gabriel edges longer than this are dropped. Without a cap, a sparse
   * outlying cluster gets long "shortcuts" back to the village that nobody
   * would actually walk. Default 520px.
   */
  maxLinkLength?: number;
}

const DEFAULTS = {
  clearance: 26,
  jitter: 6,
  step: 34,
  maxLinkLength: 520,
} as const;

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

function dist(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function inflate(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 };
}

function pointInRect(p: Point, r: Rect): boolean {
  return p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
}

/** True when segments [p1,p2] and [p3,p4] properly cross. */
function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-9) return false; // parallel or collinear
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  return t > 0 && t < 1 && u > 0 && u < 1;
}

/**
 * True when the segment enters the rect. Endpoints resting exactly on the
 * boundary do NOT count — corner waypoints sit on their own rect's edge, and
 * treating that as a collision would make every corner unreachable.
 */
export function segmentHitsRect(a: Point, b: Point, r: Rect): boolean {
  if (pointInRect(a, r) || pointInRect(b, r)) return true;
  const tl = { x: r.x, y: r.y };
  const tr = { x: r.x + r.w, y: r.y };
  const br = { x: r.x + r.w, y: r.y + r.h };
  const bl = { x: r.x, y: r.y + r.h };
  return (
    segmentsIntersect(a, b, tl, tr) ||
    segmentsIntersect(a, b, tr, br) ||
    segmentsIntersect(a, b, br, bl) ||
    segmentsIntersect(a, b, bl, tl)
  );
}

function isClear(a: Point, b: Point, obstacles: Rect[]): boolean {
  for (const r of obstacles) {
    if (segmentHitsRect(a, b, r)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Which destinations want to be linked
// ---------------------------------------------------------------------------

/**
 * Euclidean minimum spanning tree over the nodes (Prim's). Returns index
 * pairs. This is the backbone: the cheapest set of tracks that still lets you
 * walk from anywhere to anywhere.
 */
export function euclideanMst(nodes: DesireNode[]): Array<[number, number]> {
  const n = nodes.length;
  if (n < 2) return [];
  const inTree = new Array<boolean>(n).fill(false);
  const best = new Array<number>(n).fill(Infinity);
  const parent = new Array<number>(n).fill(-1);
  best[0] = 0;
  const edges: Array<[number, number]> = [];

  for (let iter = 0; iter < n; iter++) {
    let pick = -1;
    for (let i = 0; i < n; i++) {
      if (!inTree[i] && (pick === -1 || best[i]! < best[pick]!)) pick = i;
    }
    if (pick === -1) break;
    inTree[pick] = true;
    if (parent[pick] !== -1) edges.push([parent[pick]!, pick]);
    for (let i = 0; i < n; i++) {
      if (inTree[i]) continue;
      const d = dist(nodes[pick]!, nodes[i]!);
      if (d < best[i]!) { best[i] = d; parent[i] = pick; }
    }
  }
  return edges;
}

/**
 * Gabriel-graph edges: a-b qualifies when no third node falls inside the circle
 * having ab as its diameter. In practice that means "these two are each other's
 * natural neighbours with nothing in between", which is exactly the pair a
 * shortcut forms between. Superset of the MST, so it supplies the loops.
 */
export function gabrielEdges(nodes: DesireNode[], maxLength: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      const d = dist(a, b);
      if (d > maxLength) continue;
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const r2 = (d / 2) ** 2;
      let blocked = false;
      for (let k = 0; k < nodes.length; k++) {
        if (k === i || k === j) continue;
        const c = nodes[k]!;
        if ((c.x - cx) ** 2 + (c.y - cy) ** 2 < r2) { blocked = true; break; }
      }
      if (!blocked) out.push([i, j]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Routing around buildings
// ---------------------------------------------------------------------------

/**
 * Shortest obstacle-free polyline from `from` to `to`, routed through a
 * visibility graph of the obstacles' corners. Returns null when no route
 * exists (fully enclosed target), letting the caller drop an optional link.
 */
export function routeAround(
  from: Point,
  to: Point,
  obstacles: Rect[],
  corners: Point[],
): Point[] | null {
  if (isClear(from, to, obstacles)) return [from, to];

  // Node 0 = from, node 1 = to, the rest are obstacle corners.
  const nodes: Point[] = [from, to, ...corners];
  const n = nodes.length;

  // Dijkstra with lazy visibility checks — the graph is small enough that
  // computing edges on demand beats materialising the full matrix.
  const distTo = new Array<number>(n).fill(Infinity);
  const prev = new Array<number>(n).fill(-1);
  const done = new Array<boolean>(n).fill(false);
  distTo[0] = 0;

  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) {
      if (!done[i] && distTo[i]! < Infinity && (u === -1 || distTo[i]! < distTo[u]!)) u = i;
    }
    if (u === -1) break;
    if (u === 1) break; // reached the target
    done[u] = true;
    for (let v = 0; v < n; v++) {
      if (done[v] || v === u) continue;
      if (!isClear(nodes[u]!, nodes[v]!, obstacles)) continue;
      const alt = distTo[u]! + dist(nodes[u]!, nodes[v]!);
      if (alt < distTo[v]!) { distTo[v] = alt; prev[v] = u; }
    }
  }

  if (distTo[1] === Infinity) return null;

  const path: Point[] = [];
  for (let at = 1; at !== -1; at = prev[at]!) path.push(nodes[at]!);
  path.reverse();
  return path;
}

/** Inflated-footprint corners, the candidate turning points for a detour. */
export function obstacleCorners(obstacles: Rect[], clearance: number): Point[] {
  const out: Point[] = [];
  for (const r of obstacles) {
    const i = inflate(r, clearance);
    out.push(
      { x: i.x, y: i.y },
      { x: i.x + i.w, y: i.y },
      { x: i.x + i.w, y: i.y + i.h },
      { x: i.x, y: i.y + i.h },
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Organic shaping
// ---------------------------------------------------------------------------

/** Deterministic [-1, 1] from a coordinate pair — same map, same wobble. */
function noise(x: number, y: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

/**
 * Subdivide a polyline and nudge interior points sideways. Vertices where the
 * track turns a corner are preserved exactly — those bends exist to clear a
 * building, and wobbling them would walk the road back into it.
 *
 * `obstacles` is the safety net for the same reason at a finer grain: a track
 * squeezing past a building hugs its edge, and an unchecked sideways nudge is
 * enough to clip the corner of a wall. Each nudge is therefore validated as a
 * SEGMENT against the point already accepted before it — checking only whether
 * the nudged point itself landed inside a wall is not enough, because a point a
 * pixel outside the corner can still be reached by a line that cuts through it.
 *
 * Reverting a nudge is always safe: the un-nudged polyline came from
 * `routeAround`, which already proved it clear.
 */
export function organicise(
  points: Point[],
  step: number,
  jitter: number,
  obstacles: readonly Rect[] = [],
): Point[] {
  if (points.length < 2) return points;
  const out: Point[] = [points[0]!];

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = dist(a, b);
    const segments = Math.max(1, Math.round(len / step));
    const nx = len < 1e-6 ? 0 : -(b.y - a.y) / len; // unit normal
    const ny = len < 1e-6 ? 0 : (b.x - a.x) / len;

    for (let s = 1; s <= segments; s++) {
      const t = s / segments;
      const clean = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      // Taper the offset to zero at both ends so consecutive legs stay joined
      // and corner vertices keep their exact position — those bends exist to
      // clear a building.
      const taper = Math.sin(t * Math.PI);
      const amount = s === segments ? 0 : noise(clean.x, clean.y) * jitter * taper;
      const nudged = { x: clean.x + nx * amount, y: clean.y + ny * amount };

      const prev = out[out.length - 1]!;
      const blocked = obstacles.some(
        (r) => pointInRect(nudged, r) || segmentHitsRect(prev, nudged, r),
      );
      out.push(blocked ? clean : nudged);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Traffic
// ---------------------------------------------------------------------------

/**
 * Edge betweenness over the link graph: for every pair of destinations, walk
 * the shortest route and tally the tracks it uses. Normalised to 0..1.
 *
 * This is what makes the network read as worn-in rather than drawn: the spine
 * everyone funnels along comes out broad, the dead-end spur to one building
 * stays a thin trail.
 *
 * Ties are NOT split between equal-length routes — each destination is charged
 * to one predecessor, so a perfectly symmetric loop wears one arc more than its
 * mirror. Brandes' algorithm would divide the credit properly, but the only
 * visible consequence is a few pixels of width on a layout that never occurs in
 * practice, and a favoured arc is arguably truer to how real paths form.
 */
export function edgeTraffic(
  nodeCount: number,
  edges: Array<{ a: number; b: number; length: number }>,
): number[] {
  const counts = new Array<number>(edges.length).fill(0);
  const adjacency: Array<Array<{ to: number; edge: number; length: number }>> = [];
  for (let i = 0; i < nodeCount; i++) adjacency.push([]);
  edges.forEach((e, index) => {
    adjacency[e.a]!.push({ to: e.b, edge: index, length: e.length });
    adjacency[e.b]!.push({ to: e.a, edge: index, length: e.length });
  });

  for (let src = 0; src < nodeCount; src++) {
    const distTo = new Array<number>(nodeCount).fill(Infinity);
    const viaEdge = new Array<number>(nodeCount).fill(-1);
    const from = new Array<number>(nodeCount).fill(-1);
    const done = new Array<boolean>(nodeCount).fill(false);
    distTo[src] = 0;

    for (;;) {
      let u = -1;
      for (let i = 0; i < nodeCount; i++) {
        if (!done[i] && distTo[i]! < Infinity && (u === -1 || distTo[i]! < distTo[u]!)) u = i;
      }
      if (u === -1) break;
      done[u] = true;
      for (const link of adjacency[u]!) {
        const alt = distTo[u]! + link.length;
        if (alt < distTo[link.to]!) {
          distTo[link.to] = alt;
          viaEdge[link.to] = link.edge;
          from[link.to] = u;
        }
      }
    }

    // Tally each destination's route back to the source. Counting only
    // src < dst would halve every edge equally, so the ordering doesn't matter
    // — but skipping unreachable nodes does.
    for (let dst = 0; dst < nodeCount; dst++) {
      if (dst === src || distTo[dst] === Infinity) continue;
      for (let at = dst; at !== src && viaEdge[at]! !== -1; at = from[at]!) {
        counts[viaEdge[at]!]!++;
      }
    }
  }

  const max = Math.max(1, ...counts);
  return counts.map((c) => c / max);
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export function buildDesireNetwork(
  nodes: DesireNode[],
  obstacles: Rect[],
  opts: DesireOptions = {},
): DesireNetwork {
  const clearance = opts.clearance ?? DEFAULTS.clearance;
  const jitter = opts.jitter ?? DEFAULTS.jitter;
  const step = opts.step ?? DEFAULTS.step;
  const maxLinkLength = opts.maxLinkLength ?? DEFAULTS.maxLinkLength;

  if (nodes.length < 2) return { roads: [], waypoints: [], edges: [] };

  const inflated = obstacles.map((r) => inflate(r, clearance));
  const corners = obstacleCorners(obstacles, clearance);

  // Candidate links: MST backbone plus Gabriel shortcuts, deduped.
  const wanted = new Map<string, [number, number]>();
  const key = (a: number, b: number): string => `${Math.min(a, b)}-${Math.max(a, b)}`;
  for (const [a, b] of euclideanMst(nodes)) wanted.set(key(a, b), [a, b]);
  for (const [a, b] of gabrielEdges(nodes, maxLinkLength)) wanted.set(key(a, b), [a, b]);

  const routed: Array<{ a: number; b: number; points: Point[]; length: number }> = [];
  for (const [a, b] of wanted.values()) {
    const from = nodes[a]!;
    const to = nodes[b]!;

    // A door sits inside its own building's CLEARANCE ring, so testing the
    // route against that ring would declare it blocked before it left the
    // doorstep. The fix is local: for the buildings this route starts or ends
    // at, collide against the bare footprint instead of the inflated one. The
    // track can step off the door, but still cannot cut through the building.
    //
    // Dropping those buildings from the route entirely — the obvious shortcut —
    // is wrong, and was the bug: it let a track leaving the Forge carve
    // straight back through the Forge.
    const relevant = inflated.map((ring, i) =>
      pointInRect(from, ring) || pointInRect(to, ring) ? obstacles[i]! : ring,
    );

    let path = routeAround(from, to, relevant, corners);
    if (path === null) {
      // Overlapping footprints can wall a door in completely. Retry against
      // bare footprints so the village stays connected rather than silently
      // losing a link, and only give up after that.
      path = routeAround(from, to, obstacles, corners);
    }
    if (path === null) continue;

    let length = 0;
    for (let i = 1; i < path.length; i++) length += dist(path[i - 1]!, path[i]!);
    routed.push({ a, b, points: path, length });
  }

  const traffic = edgeTraffic(nodes.length, routed.map((r) => ({ a: r.a, b: r.b, length: r.length })));

  const roads: DesireRoad[] = routed.map((r, i) => ({
    a: nodes[r.a]!.id,
    b: nodes[r.b]!.id,
    points: organicise(r.points, step, jitter, obstacles),
    traffic: traffic[i] ?? 0,
  }));

  // Flatten into the routing graph heroes walk. Vertices close enough to be
  // the same junction are merged so tracks meeting at a building actually
  // connect in the graph rather than running past each other.
  const waypoints: Point[] = [];
  const edges: Array<[number, number]> = [];
  const MERGE = 12;

  function addWaypoint(p: Point): number {
    for (let i = 0; i < waypoints.length; i++) {
      if (dist(waypoints[i]!, p) <= MERGE) return i;
    }
    waypoints.push(p);
    return waypoints.length - 1;
  }

  for (const road of roads) {
    let prev = -1;
    for (const p of road.points) {
      const idx = addWaypoint(p);
      if (prev !== -1 && prev !== idx) edges.push([prev, idx]);
      prev = idx;
    }
  }

  return { roads, waypoints, edges };
}
