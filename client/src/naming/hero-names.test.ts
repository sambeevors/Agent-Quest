import { describe, test, expect } from 'bun:test';
import { heroNameFor, trainerFor } from './hero-names';
import { ROCKETS, TRAINERS } from './trainer-roster';

/** A Claude session id: 36-char uuid. All real ones share this length. */
function uuidLike(n: number): string {
  const hex = n.toString(16).padStart(12, '0');
  return `a1b2c3d4-e5f6-4a7b-8c9d-${hex}`;
}

/** A subagent id: `agent-<descriptor>-<16+ hex>`, as written by Claude Code. */
function subagentId(n: number): string {
  return `agent-Explore-${n.toString(16).padStart(16, '0')}`;
}

describe('trainerFor', () => {
  test('is deterministic for a given id', () => {
    const id = uuidLike(42);
    expect(trainerFor(id)).toBe(trainerFor(id));
    expect(heroNameFor(id)).toBe(heroNameFor(id));
  });

  test('names a real trainer: class and name, or a name alone', () => {
    expect(heroNameFor(uuidLike(1)).length).toBeGreaterThan(2);
    for (const t of TRAINERS) {
      const name = t.title === '' ? t.name : `${t.title} ${t.name}`;
      expect(name).toMatch(/^[A-Z]/);
    }
    expect(TRAINERS.some((t) => t.title === 'Youngster' && t.name === 'Joey')).toBe(true);
    expect(TRAINERS.some((t) => t.title === '' && t.name === 'Red')).toBe(true);
  });

  test('spreads same-length uuids across the roster', () => {
    // Guards the avalanche step: a plain rolling hash collapses the spread
    // for ids that differ only in their tail.
    const names = new Set<string>();
    for (let i = 0; i < 500; i++) names.add(heroNameFor(uuidLike(i)));
    expect(names.size).toBeGreaterThan(TRAINERS.length * 0.7);
  });

  test('spreads subagent ids too', () => {
    const names = new Set<string>();
    for (let i = 0; i < 200; i++) names.add(heroNameFor(subagentId(i)));
    expect(names.size).toBeGreaterThan(120);
  });

  test('Codex sessions are Team Rocket', () => {
    for (let i = 0; i < 20; i++) {
      expect(ROCKETS).toContain(trainerFor(uuidLike(i), 'codex'));
    }
    expect(heroNameFor(uuidLike(3), 'codex')).toStartWith('Rocket ');
  });

  test('survives degenerate ids', () => {
    for (const id of ['', 'x', '-']) expect(heroNameFor(id).length).toBeGreaterThan(0);
  });
});

describe('roster', () => {
  test('has no duplicate trainers', () => {
    const keys = TRAINERS.map((t) => `${t.title} ${t.name}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('names stay short enough for a canvas label', () => {
    for (const t of [...TRAINERS, ...ROCKETS]) {
      expect(`${t.title} ${t.name}`.trim().length).toBeLessThanOrEqual(20);
    }
  });
});
