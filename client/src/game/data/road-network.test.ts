import { describe, test, expect, beforeEach } from 'bun:test';
import {
  setRoadNetworkFromDesire,
  findRoadPath,
  resetRoadNetwork,
  getRoadSegments,
} from './road-network';

beforeEach(() => {
  resetRoadNetwork();
});

/** A straight west-east track, as the desire-path generator would emit it. */
function straightTrack(): { waypoints: Array<{ x: number; y: number }>; edges: Array<[number, number]> } {
  const waypoints = [{ x: 0, y: 0 }, { x: 250, y: 0 }, { x: 500, y: 0 }];
  return { waypoints, edges: [[0, 1], [1, 2]] };
}

describe('setRoadNetworkFromDesire', () => {
  test('adopts the generated graph for routing', () => {
    const { waypoints, edges } = straightTrack();
    setRoadNetworkFromDesire(waypoints, edges);
    expect(getRoadSegments()).toHaveLength(2);
  });

  test('falls back to the default graph for an empty network', () => {
    // Heroes must always be able to move somewhere, even before any building
    // has spawned.
    setRoadNetworkFromDesire([], []);
    expect(getRoadSegments().length).toBeGreaterThan(0);
  });
});

describe('findRoadPath', () => {
  test('interpolates long legs into short steps', () => {
    const { waypoints, edges } = straightTrack();
    setRoadNetworkFromDesire(waypoints, edges);
    const path = findRoadPath({ x: 0, y: 0 }, { x: 500, y: 0 });
    // 500px at ~25px steps — many small hops, not one long glide.
    expect(path.length).toBeGreaterThan(15);
    for (let i = 1; i < path.length; i++) {
      const step = Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y);
      expect(step).toBeLessThanOrEqual(40);
    }
  });

  test('starts at the origin and ends at the destination', () => {
    const { waypoints, edges } = straightTrack();
    setRoadNetworkFromDesire(waypoints, edges);
    const path = findRoadPath({ x: 0, y: 0 }, { x: 500, y: 0 });
    expect(path[0]).toEqual({ x: 0, y: 0 });
    expect(path[path.length - 1]).toEqual({ x: 500, y: 0 });
  });

  test('routes along the graph rather than cutting straight across', () => {
    // An L-shaped track: going corner-to-corner must follow the bend.
    setRoadNetworkFromDesire(
      [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }],
      [[0, 1], [1, 2]],
    );
    const path = findRoadPath({ x: 0, y: 0 }, { x: 300, y: 300 });
    // A direct cut would keep x and y climbing together; the routed path must
    // reach the corner first.
    const nearCorner = path.some((p) => Math.abs(p.x - 300) < 20 && Math.abs(p.y) < 20);
    expect(nearCorner).toBe(true);
  });

  test('still returns a usable path between disconnected components', () => {
    setRoadNetworkFromDesire(
      [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 900, y: 900 }, { x: 1000, y: 900 }],
      [[0, 1], [2, 3]],
    );
    const path = findRoadPath({ x: 0, y: 0 }, { x: 1000, y: 900 });
    expect(path.length).toBeGreaterThan(1);
    expect(path[path.length - 1]).toEqual({ x: 1000, y: 900 });
  });
});
