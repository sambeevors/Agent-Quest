import { describe, test, expect } from 'bun:test';
import { heroNameFor, FIRST_NAMES, LAST_NAMES } from './hero-names';

/** A Claude session id: 36-char uuid. All real ones share this length. */
function uuidLike(n: number): string {
  const hex = n.toString(16).padStart(12, '0');
  return `a1b2c3d4-e5f6-4a7b-8c9d-${hex}`;
}

/** A subagent id: `agent-<descriptor>-<16+ hex>`, as written by Claude Code. */
function subagentId(n: number): string {
  return `agent-Explore-${n.toString(16).padStart(16, '0')}`;
}

describe('heroNameFor', () => {
  test('is deterministic for a given id', () => {
    const id = uuidLike(42);
    expect(heroNameFor(id)).toBe(heroNameFor(id));
  });

  test('returns a first name and a surname from the tables', () => {
    for (let i = 0; i < 50; i++) {
      const parts = heroNameFor(uuidLike(i)).split(' ');
      expect(parts).toHaveLength(2);
      expect(FIRST_NAMES).toContain(parts[0]! as (typeof FIRST_NAMES)[number]);
      expect(LAST_NAMES).toContain(parts[1]! as (typeof LAST_NAMES)[number]);
    }
  });

  test('spreads same-length uuids across the whole name space', () => {
    // Guards the avalanche step: a plain rolling hash leaves the two indices
    // correlated for same-length ids and collapses the name space.
    const names = new Set<string>();
    for (let i = 0; i < 500; i++) names.add(heroNameFor(uuidLike(i)));
    expect(names.size).toBeGreaterThan(400);
  });

  test('spreads subagent ids too', () => {
    const names = new Set<string>();
    for (let i = 0; i < 200; i++) names.add(heroNameFor(subagentId(i)));
    expect(names.size).toBeGreaterThan(150);
  });

  test('survives degenerate ids', () => {
    for (const id of ['', 'x', '-']) {
      expect(heroNameFor(id).split(' ')).toHaveLength(2);
    }
  });
});

describe('name tables', () => {
  test('have no duplicate entries', () => {
    expect(new Set(FIRST_NAMES).size).toBe(FIRST_NAMES.length);
    expect(new Set(LAST_NAMES).size).toBe(LAST_NAMES.length);
  });

  test('stay short enough for the 14px monospace canvas label', () => {
    for (const n of [...FIRST_NAMES, ...LAST_NAMES]) {
      expect(n.length).toBeLessThanOrEqual(11);
    }
  });
});
