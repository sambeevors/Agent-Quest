import { describe, test, expect } from 'bun:test';
import { generateScenery, type SceneryOptions } from './scenery';
import type { Point, Rect } from './desire-paths';

const BOUNDS: Rect = { x: 0, y: 0, w: 1200, h: 900 };

function distToRect(p: Point, r: Rect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

function distToPolyline(p: Point, line: readonly Point[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const lenSq = vx * vx + vy * vy;
    let t = lenSq < 1e-9 ? 0 : ((p.x - a.x) * vx + (p.y - a.y) * vy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy)));
  }
  return best;
}

function opts(over: Partial<SceneryOptions> = {}): SceneryOptions {
  return { bounds: BOUNDS, buildings: [], roads: [], ...over };
}

describe('generateScenery', () => {
  test('produces a populated, in-bounds scatter', () => {
    const items = generateScenery(opts());
    expect(items.length).toBeGreaterThan(50);
    for (const i of items) {
      expect(i.x).toBeGreaterThanOrEqual(BOUNDS.x);
      expect(i.x).toBeLessThanOrEqual(BOUNDS.x + BOUNDS.w + 60);
      expect(i.y).toBeGreaterThanOrEqual(BOUNDS.y);
      expect(i.y).toBeLessThanOrEqual(BOUNDS.y + BOUNDS.h + 60);
    }
  });

  test('never spawns on or beside a building', () => {
    const building: Rect = { x: 500, y: 400, w: 160, h: 90 };
    const items = generateScenery(opts({ buildings: [building] }));
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) {
      // The smallest clearance of any kind is the mushroom's 20px.
      expect(distToRect(i, building)).toBeGreaterThanOrEqual(20);
    }
    // Trees keep considerably further back than the small props.
    for (const t of items.filter((i) => i.kind === 'tree')) {
      expect(distToRect(t, building)).toBeGreaterThanOrEqual(46);
    }
  });

  test('never spawns along a road', () => {
    const road: Point[] = [{ x: 0, y: 450 }, { x: 1200, y: 450 }];
    const items = generateScenery(opts({ roads: [road] }));
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) {
      expect(distToPolyline(i, road)).toBeGreaterThanOrEqual(22);
    }
    for (const t of items.filter((i) => i.kind === 'tree')) {
      expect(distToPolyline(t, road)).toBeGreaterThanOrEqual(52);
    }
  });

  test('keeps clear of a winding road, not just a straight one', () => {
    const road: Point[] = [
      { x: 0, y: 100 }, { x: 300, y: 400 }, { x: 600, y: 200 },
      { x: 900, y: 700 }, { x: 1200, y: 300 },
    ];
    const items = generateScenery(opts({ roads: [road] }));
    for (const i of items) {
      expect(distToPolyline(i, road)).toBeGreaterThanOrEqual(22);
    }
  });

  test('respects arbitrary exclusion rects', () => {
    const lake: Rect = { x: 200, y: 200, w: 400, h: 300 };
    const items = generateScenery(opts({ exclusions: [lake] }));
    for (const i of items) {
      expect(distToRect(i, lake)).toBeGreaterThan(0);
    }
  });

  test('is deterministic for a given seed, and varies with it', () => {
    const a = generateScenery(opts({ seed: 42 }));
    const b = generateScenery(opts({ seed: 42 }));
    const c = generateScenery(opts({ seed: 43 }));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  test('thins out near a settlement so it sits in a clearing', () => {
    const building: Rect = { x: 560, y: 400, w: 160, h: 90 };
    const items = generateScenery(opts({ buildings: [building] }));
    const centre = { x: 640, y: 445 };
    const near = items.filter((i) => Math.hypot(i.x - centre.x, i.y - centre.y) < 300).length;
    const far = items.filter((i) => {
      const d = Math.hypot(i.x - centre.x, i.y - centre.y);
      return d >= 300 && d < 600;
    }).length;
    // Compare by area — the outer annulus is larger, so raw counts would not
    // be a fair comparison.
    const nearArea = Math.PI * 300 ** 2;
    const farArea = Math.PI * (600 ** 2 - 300 ** 2);
    expect(near / nearArea).toBeLessThan(far / farArea);
  });

  test('spaces items of the same kind apart', () => {
    const items = generateScenery(opts());
    const trees = items.filter((i) => i.kind === 'tree');
    for (let i = 0; i < trees.length; i++) {
      for (let j = i + 1; j < trees.length; j++) {
        expect(Math.hypot(trees[i]!.x - trees[j]!.x, trees[i]!.y - trees[j]!.y))
          .toBeGreaterThanOrEqual(54);
      }
    }
  });

  test('scales every kind alike, so native art size decides what looks big', () => {
    // A tree frame is 192px and a mushroom's 64px. Scaling both the same is
    // what makes the tree three times the mushroom — which is how the pack
    // drew them. A per-kind scale would silently overrule the artist.
    const byKind = new Map<string, number[]>();
    for (const i of generateScenery(opts())) {
      const list = byKind.get(i.kind) ?? [];
      list.push(i.scale);
      byKind.set(i.kind, list);
    }
    expect(byKind.size).toBeGreaterThan(1);
    const ranges = [...byKind.values()].map((v) => [Math.min(...v), Math.max(...v)]);
    for (const [lo, hi] of ranges) {
      expect(lo).toBeCloseTo(ranges[0]![0]!, 1);
      expect(hi).toBeCloseTo(ranges[0]![1]!, 1);
    }
  });

  test('varies size a little within a kind, so a stand of trees is not stamped', () => {
    const trees = generateScenery(opts()).filter((i) => i.kind === 'tree').map((t) => t.scale);
    expect(new Set(trees).size).toBeGreaterThan(5);
  });

  test('emits only variants that exist for each kind', () => {
    const maxVariant: Record<string, number> = { tree: 4, bush: 3, rock: 5, mushroom: 3 };
    for (const i of generateScenery(opts())) {
      expect(i.variant).toBeGreaterThanOrEqual(1);
      expect(i.variant).toBeLessThanOrEqual(maxVariant[i.kind]!);
    }
  });

  test('returns back-to-front order so canopies overlap correctly', () => {
    const items = generateScenery(opts());
    for (let i = 1; i < items.length; i++) {
      expect(items[i]!.y).toBeGreaterThanOrEqual(items[i - 1]!.y);
    }
  });

  test('places nothing when every candidate is inside a building', () => {
    // Overhangs the bounds so the sampler's jitter can't land a candidate just
    // past the far edge.
    const items = generateScenery(opts({
      buildings: [{ x: -200, y: -200, w: 1800, h: 1500 }],
    }));
    expect(items).toEqual([]);
  });
});
