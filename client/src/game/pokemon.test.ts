import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { iconTextureKey, iconUrl, imagePreload, UI_ICONS, portraitUrl, spritesheetPreload, standFrame, walkFrames, partnerSpec, trainerTextureKey } from './pokemon';
import { TOWN_COLS, TOWN_ROWS, TILE } from './town/town';
import { ROCKETS, TRAINERS } from '../naming/trainer-roster';
import { STATION_ITEMS } from '../progress/stations';

/** The contract between scripts/bake-pokemon/ and the code that reads it. */

const PUBLIC = join(import.meta.dir, '../../public');

/** [width, height] from a PNG's IHDR chunk. */
function pngSize(publicPath: string): [number, number] {
  const buf = readFileSync(join(PUBLIC, publicPath.replace(/^\//, '')));
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

describe('baked art', () => {
  test('the town layers cover the walk grid exactly', () => {
    const [ground, overhead] = imagePreload();
    expect(pngSize(ground!.path)).toEqual([TOWN_COLS * TILE, TOWN_ROWS * TILE]);
    expect(pngSize(overhead!.path)).toEqual([TOWN_COLS * TILE, TOWN_ROWS * TILE]);
  });

  test('door frames are one block', () => {
    const icons = new Set(UI_ICONS.map(iconTextureKey));
    const doors = imagePreload().slice(2).filter((e) => !icons.has(e.key));
    expect(doors.length).toBeGreaterThan(0);
    for (const e of doors) expect(pngSize(e.path)).toEqual([TILE, TILE]);
  });

  test('station items are bag icons at native size; the flower is one bed block', () => {
    for (const item of Object.values(STATION_ITEMS)) {
      expect(pngSize(iconUrl(item.icon))).toEqual(item.icon === 'flower' ? [16, 16] : [24, 24]);
    }
  });

  test('every trainer has a four-way walker, a portrait and a partner', () => {
    const sheets = new Map(spritesheetPreload().map((e) => [e.key, e]));
    for (const t of [...TRAINERS, ...ROCKETS]) {
      const walker = sheets.get(trainerTextureKey(t));
      expect(walker).toBeDefined();
      expect(pngSize(walker!.path)).toEqual([walker!.frameWidth * 12, 32]);
      expect(pngSize(portraitUrl(t))).toEqual([96, 96]);
      expect(sheets.has(partnerSpec(t).textureKey)).toBe(true);
    }
  });

  test('walk cycles stay inside each direction’s three frames', () => {
    for (const facing of ['down', 'up', 'left', 'right'] as const) {
      for (const f of walkFrames(facing)) {
        expect(f - standFrame(facing)).toBeGreaterThanOrEqual(0);
        expect(f - standFrame(facing)).toBeLessThan(3);
      }
    }
  });
});
