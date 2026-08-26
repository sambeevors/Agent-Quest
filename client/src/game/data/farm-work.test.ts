import { describe, test, expect } from 'bun:test';
import { nextTendDelay, pickBed } from './farm-work';
import { SUNNYSIDE_SHEET } from '../themes/sunnyside-sheet';

const BEDS = SUNNYSIDE_SHEET.buildings.crops.farm.length;

describe('pickBed', () => {
  test('never returns a bed another hero has claimed', () => {
    const taken = new Set([0, 1, 2, 3]);
    for (let i = 0; i < 200; i++) {
      const bed = pickBed(BEDS, taken, null);
      expect(bed).not.toBeNull();
      expect(taken.has(bed!)).toBe(false);
    }
  });

  test('never returns the bed the hero is already on — a hop must move it', () => {
    for (let current = 0; current < BEDS; current++) {
      for (let i = 0; i < 20; i++) {
        expect(pickBed(BEDS, new Set(), current)).not.toBe(current);
      }
    }
  });

  test('reaches every free bed', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(pickBed(BEDS, new Set(), null)!);
    expect(seen.size).toBe(BEDS);
  });

  test('returns null when there is nowhere else to stand', () => {
    // Every bed taken, and the hero is on one of them.
    const taken = new Set(Array.from({ length: BEDS }, (_, i) => i));
    expect(pickBed(BEDS, taken, 3)).toBeNull();
    // A single-bed farm: the hero stays put rather than hopping in place.
    expect(pickBed(1, new Set(), 0)).toBeNull();
    expect(pickBed(0, new Set(), null)).toBeNull();
  });

  test('stays in range when rand() returns its exclusive upper bound', () => {
    // Math.random() never returns 1, but a stub might — and an out-of-range
    // index here would station a hero at undefined coordinates.
    expect(pickBed(BEDS, new Set(), null, () => 1)).toBe(BEDS - 1);
    expect(pickBed(BEDS, new Set(), null, () => 0)).toBe(0);
  });
});

describe('nextTendDelay', () => {
  test('spans a few seconds of watering, never zero', () => {
    expect(nextTendDelay(() => 0)).toBeGreaterThan(3000);
    expect(nextTendDelay(() => 0.999)).toBeLessThan(15000);
    expect(nextTendDelay(() => 0)).toBeLessThan(nextTendDelay(() => 1));
  });
});

describe('the farm the beds come from', () => {
  test('every bed centre lies inside the interior heroes may stand on', () => {
    const [ix, iy, iw, ih] = SUNNYSIDE_SHEET.buildings.interior.farm;
    for (const [x, y] of SUNNYSIDE_SHEET.buildings.crops.farm) {
      expect(x).toBeGreaterThanOrEqual(ix);
      expect(x).toBeLessThanOrEqual(ix + iw);
      expect(y).toBeGreaterThanOrEqual(iy);
      expect(y).toBeLessThanOrEqual(iy + ih);
    }
  });

  test('the beds form the three rows of five the recipe paints', () => {
    const rows = new Set(SUNNYSIDE_SHEET.buildings.crops.farm.map(([, y]) => y));
    const cols = new Set(SUNNYSIDE_SHEET.buildings.crops.farm.map(([x]) => x));
    expect(rows.size).toBe(3);
    expect(cols.size).toBe(5);
    expect(BEDS).toBe(15);
  });
});
