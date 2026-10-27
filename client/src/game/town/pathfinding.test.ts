import { describe, test, expect } from 'bun:test';
import { corners, findTilePath, findWalk, nearestWalkable } from './pathfinding';
import { footOf, isWalkable, SPAWN_TILE, TOWN_BUILDINGS, type Tile } from './town';

/** A little map: '#' blocked, '.' walkable. */
function grid(rows: string[]): (x: number, y: number) => boolean {
  return (x, y) => rows[y]?.[x] === '.';
}

describe('findTilePath', () => {
  test('walks around walls, four ways only', () => {
    const walk = grid([
      '.....',
      '.###.',
      '.....',
    ]);
    const path = findTilePath([0, 0], [4, 2], walk)!;
    expect(path[0]).toEqual([0, 0]);
    expect(path[path.length - 1]).toEqual([4, 2]);
    expect(path).toHaveLength(7);
    for (let i = 1; i < path.length; i++) {
      const [ax, ay] = path[i - 1]!;
      const [bx, by] = path[i]!;
      expect(Math.abs(ax - bx) + Math.abs(ay - by)).toBe(1);
      expect(walk(bx, by)).toBe(true);
    }
  });

  test('returns null when walled off', () => {
    const walk = grid(['..#..']);
    expect(findTilePath([0, 0], [4, 0], walk)).toBeNull();
  });

  test('prefers fewer turns among equal routes', () => {
    const walk = grid([
      '....',
      '....',
      '....',
    ]);
    expect(corners(findTilePath([0, 0], [3, 2], walk)!)).toHaveLength(3);
  });
});

describe('nearestWalkable', () => {
  test('snaps a blocked tile to the closest open one', () => {
    const walk = grid(['##.', '###']);
    expect(nearestWalkable([0, 0], walk)).toEqual([2, 0]);
  });
});

describe('the town', () => {
  const reach = (from: Tile, to: Tile): boolean => findTilePath(from, to) !== null;

  test('every building slot is walkable and reachable from the spawn', () => {
    expect(isWalkable(...SPAWN_TILE)).toBe(true);
    for (const [id, b] of Object.entries(TOWN_BUILDINGS)) {
      expect(b.slots.length).toBeGreaterThan(0);
      for (const s of b.slots) {
        expect(isWalkable(s[0], s[1])).toBe(true);
        expect(reach(SPAWN_TILE, s)).toBe(true);
      }
      for (const f of b.fighters ?? []) expect(isWalkable(f[0], f[1])).toBe(true);
      expect(id.length).toBeGreaterThan(0);
    }
  });

  test('no two buildings share a slot', () => {
    const seen = new Map<string, string>();
    for (const [id, b] of Object.entries(TOWN_BUILDINGS)) {
      for (const s of b.slots) {
        const k = s.join(',');
        expect(seen.get(k) ?? id).toBe(id);
        seen.set(k, id);
      }
    }
  });

  test('a doorstep is the tile right below its door', () => {
    for (const b of Object.values(TOWN_BUILDINGS)) {
      if (b.doors.length === 0) continue;
      const [sx, sy] = b.slots[0]!;
      expect(b.doors.some(([dx, dy]) => dx === sx && dy + 1 === sy)).toBe(true);
      // Trainers go in (and come out) through the tile below every door.
      for (const [dx, dy] of b.doors) expect(isWalkable(dx, dy + 1)).toBe(true);
    }
  });

  test('walks between buildings stay on walkable ground and turn at right angles', () => {
    const from = footOf(SPAWN_TILE);
    for (const b of Object.values(TOWN_BUILDINGS)) {
      const to = footOf(b.slots[0]!);
      const walk = findWalk(from, to);
      expect(walk[0]).toEqual(from);
      expect(walk[walk.length - 1]).toEqual(to);
      for (let i = 1; i < walk.length; i++) {
        const a = walk[i - 1]!;
        const p = walk[i]!;
        expect(a.x === p.x || a.y === p.y).toBe(true);
      }
    }
  });
});
