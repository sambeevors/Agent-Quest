import { describe, test, expect } from 'bun:test';
import { DETOUR_AFTER_WAITS, PUSH_THROUGH_AFTER_WAITS, Traffic } from './traffic';
import { findDetour, findWalk } from './pathfinding';
import { footOf, tileAt, type Point, type Tile } from './town';

/** A little map: '#' blocked, '.' walkable. */
function grid(rows: string[]): (x: number, y: number) => boolean {
  return (x, y) => rows[y]?.[x] === '.';
}

/** Every tile a corner-only walk passes over. */
function tilesOf(walk: readonly Point[]): Tile[] {
  const out: Tile[] = [tileAt(walk[0]!)];
  for (let i = 1; i < walk.length; i++) {
    const [ax, ay] = tileAt(walk[i - 1]!);
    const [bx, by] = tileAt(walk[i]!);
    const n = Math.abs(bx - ax) + Math.abs(by - ay);
    for (let s = 1; s <= n; s++) {
      out.push([ax + Math.sign(bx - ax) * s, ay + Math.sign(by - ay) * s]);
    }
  }
  return out;
}

describe('Traffic', () => {
  test('one trainer per tile', () => {
    const t = new Traffic();
    expect(t.claim('a', [1, 1])).toBe(true);
    expect(t.claim('a', [1, 1])).toBe(true);
    expect(t.claim('b', [1, 1])).toBe(false);
    expect(t.holder([1, 1])).toBe('a');
  });

  test('a step holds both tiles until it lands, then only the new one', () => {
    const t = new Traffic();
    t.claim('a', [1, 1]);
    t.claim('a', [2, 1]);
    expect(t.holder([1, 1])).toBe('a');
    t.settle('a', [2, 1]);
    expect(t.holder([1, 1])).toBeUndefined();
    expect(t.holder([2, 1])).toBe('a');
  });

  test('going indoors frees the tile', () => {
    const t = new Traffic();
    t.claim('a', [1, 1]);
    t.release('a');
    expect(t.claim('b', [1, 1])).toBe(true);
  });

  test('routes plan round trainers standing still, not round passers-by', () => {
    const t = new Traffic();
    t.claim('parked', [1, 1]);
    t.claim('walker', [2, 2]);
    t.setWalking('walker', true);
    const avoid = t.obstacles('me');
    expect(avoid(1, 1)).toBe(true);
    expect(avoid(2, 2)).toBe(false);
    // ...unless the walker is the one in the way right now.
    expect(t.obstacles('me', 'walker')(2, 2)).toBe(true);
    // Your own tile is never in your way.
    expect(t.obstacles('parked')(1, 1)).toBe(false);
  });

  test('goes round someone standing still at once', () => {
    const t = new Traffic();
    t.claim('parked', [1, 1]);
    expect(t.onBlocked('me', [1, 1], 0).action).toBe('detour');
  });

  test('waits for a walker to pass, then goes round', () => {
    const t = new Traffic();
    t.claim('walker', [1, 1]);
    t.setWalking('walker', true);
    expect(t.onBlocked('me', [1, 1], 0).action).toBe('wait');
    expect(t.onBlocked('me', [1, 1], 1).action).toBe('wait');
    expect(t.onBlocked('me', [1, 1], DETOUR_AFTER_WAITS).action).toBe('detour');
  });

  test('face to face, exactly one steps aside', () => {
    const t = new Traffic();
    t.claim('a', [1, 1]);
    t.claim('b', [2, 1]);
    t.setWalking('a', true);
    t.setWalking('b', true);
    t.onBlocked('b', [1, 1], 0);
    expect(t.onBlocked('a', [2, 1], 1).action).toBe('detour');
    expect(t.onBlocked('b', [1, 1], 1).action).toBe('wait');
  });

  test('never stranded: with no way round, steps through in the end', () => {
    const t = new Traffic();
    t.claim('parked', [1, 1]);
    expect(t.onBlocked('me', [1, 1], PUSH_THROUGH_AFTER_WAITS.standing).action).toBe('push');
    t.claim('walker', [2, 2]);
    t.setWalking('walker', true);
    expect(t.onBlocked('me', [2, 2], PUSH_THROUGH_AFTER_WAITS.standing).action).not.toBe('push');
    expect(t.onBlocked('me', [2, 2], PUSH_THROUGH_AFTER_WAITS.walking).action).toBe('push');
  });
});

describe('detours', () => {
  const street = grid([
    '.....',
    '.....',
    '.....',
  ]);
  const flat = (): number => 1;

  test('a walk steps round a trainer standing in the street', () => {
    const t = new Traffic();
    t.claim('parked', [2, 1]);
    const walk = findWalk(footOf([0, 1]), footOf([4, 1]), street, flat, t.obstacles('me'));
    const tiles = tilesOf(walk);
    expect(tiles.some(([x, y]) => x === 2 && y === 1)).toBe(false);
    expect(tiles[tiles.length - 1]).toEqual([4, 1]);
  });

  test('with no way round, the walk goes through rather than nowhere', () => {
    const lane = grid(['.....']);
    const t = new Traffic();
    t.claim('parked', [2, 0]);
    expect(findDetour(footOf([0, 0]), footOf([4, 0]), t.obstacles('me'), lane, flat)).toBeNull();
    const walk = findWalk(footOf([0, 0]), footOf([4, 0]), lane, flat, t.obstacles('me'));
    expect(walk[walk.length - 1]).toEqual(footOf([4, 0]));
  });

  test('the goal counts even when someone is still standing on it', () => {
    const t = new Traffic();
    t.claim('leaving', [4, 1]);
    const walk = findDetour(footOf([0, 1]), footOf([4, 1]), t.obstacles('me'), street, flat);
    expect(walk).not.toBeNull();
  });
});
