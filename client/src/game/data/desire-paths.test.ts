import { describe, test, expect } from 'bun:test';
import {
  segmentHitsRect, euclideanMst, gabrielEdges, routeAround, obstacleCorners,
  organicise, edgeTraffic, buildDesireNetwork,
  type Rect, type DesireNode, type Point,
} from './desire-paths';

/** A 100×100 building sitting at (200,200)-(300,300). */
const BOX: Rect = { x: 200, y: 200, w: 100, h: 100 };

function len(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  }
  return total;
}

describe('segmentHitsRect', () => {
  test('detects a segment passing straight through', () => {
    expect(segmentHitsRect({ x: 100, y: 250 }, { x: 400, y: 250 }, BOX)).toBe(true);
  });

  test('detects an endpoint inside the rect', () => {
    expect(segmentHitsRect({ x: 250, y: 250 }, { x: 400, y: 400 }, BOX)).toBe(true);
  });

  test('passes a segment clear of the rect', () => {
    expect(segmentHitsRect({ x: 100, y: 100 }, { x: 400, y: 100 }, BOX)).toBe(false);
  });

  test('treats grazing the boundary as clear', () => {
    // Corner waypoints sit exactly on their own inflated rect's edge. Counting
    // that as a collision would make every detour corner unreachable.
    expect(segmentHitsRect({ x: 100, y: 200 }, { x: 400, y: 200 }, BOX)).toBe(false);
    expect(segmentHitsRect({ x: 200, y: 200 }, { x: 200, y: 300 }, BOX)).toBe(false);
  });
});

describe('euclideanMst', () => {
  test('connects n nodes with n-1 edges', () => {
    const nodes: DesireNode[] = [
      { id: 'a', x: 0, y: 0 }, { id: 'b', x: 100, y: 0 },
      { id: 'c', x: 200, y: 0 }, { id: 'd', x: 300, y: 0 },
    ];
    expect(euclideanMst(nodes)).toHaveLength(3);
  });

  test('picks the short chain rather than long hops', () => {
    const nodes: DesireNode[] = [
      { id: 'a', x: 0, y: 0 }, { id: 'b', x: 10, y: 0 }, { id: 'c', x: 1000, y: 0 },
    ];
    const edges = euclideanMst(nodes).map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`);
    expect(edges).toContain('0-1');
    expect(edges).toContain('1-2');
    expect(edges).not.toContain('0-2');
  });

  test('handles degenerate inputs', () => {
    expect(euclideanMst([])).toEqual([]);
    expect(euclideanMst([{ id: 'a', x: 0, y: 0 }])).toEqual([]);
  });
});

describe('gabrielEdges', () => {
  test('drops a link whose midpoint circle contains another node', () => {
    // b sits between a and c, so a-c is not a Gabriel edge.
    const nodes: DesireNode[] = [
      { id: 'a', x: 0, y: 0 }, { id: 'b', x: 50, y: 0 }, { id: 'c', x: 100, y: 0 },
    ];
    const keys = gabrielEdges(nodes, 1000).map(([a, b]) => `${a}-${b}`);
    expect(keys).toContain('0-1');
    expect(keys).toContain('1-2');
    expect(keys).not.toContain('0-2');
  });

  test('respects the maximum link length', () => {
    const nodes: DesireNode[] = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 900, y: 0 }];
    expect(gabrielEdges(nodes, 520)).toHaveLength(0);
    expect(gabrielEdges(nodes, 1000)).toHaveLength(1);
  });
});

describe('routeAround', () => {
  const corners = obstacleCorners([BOX], 20);
  const inflated: Rect[] = [{ x: 180, y: 180, w: 140, h: 140 }];

  test('goes straight when nothing is in the way', () => {
    expect(routeAround({ x: 0, y: 0 }, { x: 100, y: 0 }, inflated, corners))
      .toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  });

  test('bends around a building instead of through it', () => {
    const from = { x: 100, y: 250 };
    const to = { x: 400, y: 250 };
    const path = routeAround(from, to, inflated, corners)!;

    expect(path).not.toBeNull();
    expect(path.length).toBeGreaterThan(2); // detoured
    // Every leg of the result must clear the obstacle.
    for (let i = 1; i < path.length; i++) {
      expect(segmentHitsRect(path[i - 1]!, path[i]!, inflated[0]!)).toBe(false);
    }
    // And it should be a detour, not a wild excursion.
    expect(len(path)).toBeLessThan(len([from, to]) * 2);
  });

  test('returns null when the target is walled in', () => {
    // Four rects boxing in the destination with no gap to slip through.
    const walls: Rect[] = [
      { x: 400, y: 400, w: 200, h: 20 },
      { x: 400, y: 580, w: 200, h: 20 },
      { x: 400, y: 400, w: 20, h: 200 },
      { x: 580, y: 400, w: 20, h: 200 },
    ];
    const path = routeAround({ x: 0, y: 0 }, { x: 500, y: 500 }, walls, obstacleCorners(walls, 5));
    expect(path).toBeNull();
  });
});

describe('organicise', () => {
  test('keeps both endpoints exactly where they were', () => {
    const points = [{ x: 0, y: 0 }, { x: 300, y: 0 }];
    const out = organicise(points, 30, 8);
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[out.length - 1]).toEqual({ x: 300, y: 0 });
  });

  test('preserves corner vertices so detours stay clear of buildings', () => {
    const corner = { x: 180, y: 180 };
    const out = organicise([{ x: 0, y: 0 }, corner, { x: 400, y: 0 }], 30, 8);
    expect(out).toContainEqual(corner);
  });

  test('adds intermediate points and wobbles them within the jitter bound', () => {
    const out = organicise([{ x: 0, y: 0 }, { x: 300, y: 0 }], 30, 8);
    expect(out.length).toBeGreaterThan(2);
    for (const p of out) expect(Math.abs(p.y)).toBeLessThanOrEqual(8);
  });

  test('is deterministic — the same input always wobbles the same way', () => {
    const input = [{ x: 17, y: 43 }, { x: 421, y: 289 }];
    expect(organicise(input, 30, 8)).toEqual(organicise(input, 30, 8));
  });

  test('leaves a degenerate polyline alone', () => {
    expect(organicise([{ x: 1, y: 2 }], 30, 8)).toEqual([{ x: 1, y: 2 }]);
  });
});

describe('edgeTraffic', () => {
  test('wears the shared spine broader than the spurs', () => {
    // Two hubs (0,1) joined by one bridge, each with a dead-end spur.
    //   2 --- 0 === 1 --- 3
    const traffic = edgeTraffic(4, [
      { a: 0, b: 1, length: 100 }, // bridge — every cross-village journey uses it
      { a: 0, b: 2, length: 100 }, // spur
      { a: 1, b: 3, length: 100 }, // spur
    ]);
    expect(traffic[0]).toBe(1);
    expect(traffic[1]!).toBeLessThan(traffic[0]!);
    expect(traffic[2]!).toBeLessThan(traffic[0]!);
  });

  test('keeps a symmetric ring within range, favouring one arc on ties', () => {
    // Opposite corners of a 4-cycle have two equally short routes. Ties go to
    // a single predecessor rather than being split, so the arcs differ — see
    // the note on edgeTraffic. All that matters is the values stay usable.
    const traffic = edgeTraffic(4, [
      { a: 0, b: 1, length: 100 }, { a: 1, b: 2, length: 100 },
      { a: 2, b: 3, length: 100 }, { a: 3, b: 0, length: 100 },
    ]);
    expect(traffic).toHaveLength(4);
    for (const t of traffic) {
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThanOrEqual(1);
    }
  });

  test('copes with a disconnected graph', () => {
    const traffic = edgeTraffic(4, [{ a: 0, b: 1, length: 10 }, { a: 2, b: 3, length: 10 }]);
    expect(traffic).toHaveLength(2);
    expect(traffic.every((t) => Number.isFinite(t))).toBe(true);
  });
});

describe('buildDesireNetwork', () => {
  /** Four doors around a central building, as a village-in-miniature. */
  const nodes: DesireNode[] = [
    { id: 'n', x: 250, y: 100 },
    { id: 's', x: 250, y: 400 },
    { id: 'w', x: 100, y: 250 },
    { id: 'e', x: 400, y: 250 },
  ];

  test('connects every destination', () => {
    const net = buildDesireNetwork(nodes, [BOX]);
    const linked = new Set(net.roads.flatMap((r) => [r.a, r.b]));
    expect(linked).toEqual(new Set(['n', 's', 'w', 'e']));
  });

  test('no road segment crosses a building', () => {
    const net = buildDesireNetwork(nodes, [BOX], { clearance: 25 });
    for (const road of net.roads) {
      for (let i = 1; i < road.points.length; i++) {
        expect(segmentHitsRect(road.points[i - 1]!, road.points[i]!, BOX)).toBe(false);
      }
    }
  });

  test('produces a connected routing graph for the heroes', () => {
    const net = buildDesireNetwork(nodes, [BOX]);
    expect(net.waypoints.length).toBeGreaterThan(0);

    const adjacency = new Map<number, number[]>();
    for (const [a, b] of net.edges) {
      if (!adjacency.has(a)) adjacency.set(a, []);
      if (!adjacency.has(b)) adjacency.set(b, []);
      adjacency.get(a)!.push(b);
      adjacency.get(b)!.push(a);
    }
    const seen = new Set<number>([0]);
    const queue = [0];
    while (queue.length > 0) {
      for (const next of adjacency.get(queue.shift()!) ?? []) {
        if (!seen.has(next)) { seen.add(next); queue.push(next); }
      }
    }
    expect(seen.size).toBe(net.waypoints.length);
  });

  test('assigns traffic in 0..1 with at least one fully-worn track', () => {
    const net = buildDesireNetwork(nodes, [BOX]);
    for (const road of net.roads) {
      expect(road.traffic).toBeGreaterThanOrEqual(0);
      expect(road.traffic).toBeLessThanOrEqual(1);
    }
    expect(Math.max(...net.roads.map((r) => r.traffic))).toBe(1);
  });

  test('is deterministic across rebuilds', () => {
    expect(buildDesireNetwork(nodes, [BOX])).toEqual(buildDesireNetwork(nodes, [BOX]));
  });

  test('returns an empty network for fewer than two destinations', () => {
    expect(buildDesireNetwork([], [])).toEqual({ roads: [], waypoints: [], edges: [] });
    expect(buildDesireNetwork([nodes[0]!], [BOX]).roads).toEqual([]);
  });

  test('still links a door that sits against its own building', () => {
    // A door touching its building must not be considered blocked by it.
    const doors: DesireNode[] = [
      { id: 'door', x: 250, y: 305 },
      { id: 'far', x: 250, y: 600 },
    ];
    const net = buildDesireNetwork(doors, [BOX]);
    expect(net.roads).toHaveLength(1);
  });

  test('a track never cuts back through the building it starts from', () => {
    // Regression: letting a door escape its own clearance ring must not be
    // done by dropping that building from the route. It was, and tracks
    // leaving a door carved straight back through their own building whenever
    // the destination lay behind it.
    //
    // The door is at the bottom of BOX; the target is up and to the left, so
    // the straight line between them clips BOX's own corner.
    const doors: DesireNode[] = [
      { id: 'door', x: 250, y: 305 },
      { id: 'behind', x: 100, y: 150 },
    ];
    const net = buildDesireNetwork(doors, [BOX]);
    expect(net.roads).toHaveLength(1);
    for (const road of net.roads) {
      for (let i = 1; i < road.points.length; i++) {
        expect(segmentHitsRect(road.points[i - 1]!, road.points[i]!, BOX)).toBe(false);
      }
    }
  });

  test('no track crosses ANY building, including its own endpoints', () => {
    // A ring of doors around two buildings — the arrangement that surfaced the
    // bug in the real village, where most links have a building at one end.
    const boxes: Rect[] = [BOX, { x: 420, y: 200, w: 100, h: 100 }];
    const doors: DesireNode[] = [
      { id: 'a', x: 250, y: 305 },
      { id: 'b', x: 470, y: 305 },
      { id: 'c', x: 120, y: 180 },
      { id: 'd', x: 600, y: 180 },
      { id: 'e', x: 360, y: 520 },
    ];
    const net = buildDesireNetwork(doors, boxes);
    expect(net.roads.length).toBeGreaterThan(0);
    for (const road of net.roads) {
      for (const box of boxes) {
        for (let i = 1; i < road.points.length; i++) {
          expect(segmentHitsRect(road.points[i - 1]!, road.points[i]!, box)).toBe(false);
        }
      }
    }
  });

  test('heavy jitter never nudges a track into a wall', () => {
    // The wobble is applied after routing, so it can push a point that squeezes
    // past a building into its corner. Guarding the POINT alone missed this:
    // a point a pixel outside the corner is still reachable only by a line that
    // cuts through it, so the guard has to test the segment.
    //
    // A tight lane between two buildings with an exaggerated jitter is the
    // arrangement that provokes it.
    const boxes: Rect[] = [
      { x: 200, y: 200, w: 120, h: 120 },
      { x: 420, y: 200, w: 120, h: 120 },
    ];
    const doors: DesireNode[] = [
      { id: 'south', x: 370, y: 400 },
      { id: 'north', x: 370, y: 120 },
      { id: 'west', x: 140, y: 260 },
      { id: 'east', x: 600, y: 260 },
    ];
    const net = buildDesireNetwork(doors, boxes, { clearance: 22, jitter: 18, step: 16 });
    expect(net.roads.length).toBeGreaterThan(0);
    for (const road of net.roads) {
      for (const box of boxes) {
        for (let i = 1; i < road.points.length; i++) {
          expect(segmentHitsRect(road.points[i - 1]!, road.points[i]!, box)).toBe(false);
        }
      }
    }
  });
});
