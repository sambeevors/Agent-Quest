import { describe, test, expect } from 'bun:test';
import { tinySwordsCc0Theme, DOOR_HEIGHT } from './tiny-swords-cc0';

/**
 * The building PNGs are drawn at zooms that differ by a factor of two, so the
 * thing worth pinning is not any one scale but the consequence: whatever a
 * building is, a person has to be able to walk through its door.
 */
describe('building scale', () => {
  const ids = Object.keys(DOOR_HEIGHT);

  test('renders every doorway at the same size', () => {
    const doors = ids.map((id) => tinySwordsCc0Theme.getBuildingScale(id) * DOOR_HEIGHT[id]!);
    for (const d of doors) expect(d).toBeCloseTo(doors[0]!, 6);
  });

  test('keeps a doorway a little over a villager tall', () => {
    // A pawn's artwork is 59px inside its 192px frame; heroes render at the
    // map's own scale, near the theme's. A door much under this and heroes
    // would tower over the buildings they walk into.
    const villager = 59 * tinySwordsCc0Theme.heroScale;
    const door = tinySwordsCc0Theme.getBuildingScale('tavern') * DOOR_HEIGHT['tavern']!;
    expect(door).toBeGreaterThan(villager * 0.6);
    expect(door).toBeLessThan(villager * 1.6);
  });

  test('scales a building drawn at twice the zoom by half as much', () => {
    // The Alchemist's 140px doorway against the Chapel's 70px.
    expect(tinySwordsCc0Theme.getBuildingScale('alchemist'))
      .toBeCloseTo(tinySwordsCc0Theme.getBuildingScale('chapel') / 2, 6);
  });

  test('falls back to the family scale for an unknown building', () => {
    expect(tinySwordsCc0Theme.getBuildingScale('gatehouse'))
      .toBe(tinySwordsCc0Theme.buildingScale);
  });
});
