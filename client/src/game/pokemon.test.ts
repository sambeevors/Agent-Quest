import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { imagePreload, portraitUrl, spritesheetPreload, standFrame, walkFrames, partnerSpec, trainerTextureKey } from './pokemon';
import { TOWN_COLS, TOWN_ROWS, TILE } from './town/town';
import { ROCKETS, TRAINERS } from '../naming/trainer-roster';

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
    for (const e of imagePreload().slice(2)) expect(pngSize(e.path)).toEqual([TILE, TILE]);
  });

  test('every trainer has a four-way walker, a portrait and a partner', () => {
    const sheets = new Map(spritesheetPreload().map((e) => [e.key, e]));
    for (const t of [...TRAINERS, ...ROCKETS]) {
      const walker = sheets.get(trainerTextureKey(t));
      expect(walker).toBeDefined();
      expect(pngSize(walker!.path)).toEqual([16 * 12, 32]);
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
