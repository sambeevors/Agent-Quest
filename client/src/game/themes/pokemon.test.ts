import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pokemonTheme } from './pokemon';
import { POKEMON_SHEET } from './pokemon-sheet';
import { POKEMON_CHATTER } from './pokemon-chatter';
import { BUILDING_DEFS } from '../data/building-layout';
import { HERO_CLASSES, HERO_COLORS } from '../../types/agent';

/** The contract between scripts/bake-pokemon/ and the theme that reads it. */

const PUBLIC = join(import.meta.dir, '../../../public');
const VILLAGE = JSON.parse(readFileSync(join(import.meta.dir, '../../../../server/data/map/village.json'), 'utf8')) as {
  buildings: Array<{ id: string; x: number; y: number }>;
};

/** [width, height] from a PNG's IHDR chunk. */
function pngSize(publicPath: string): [number, number] {
  const buf = readFileSync(join(PUBLIC, publicPath.replace(/^\//, '')));
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

type Rect = { x: number; y: number; w: number; h: number };

function rectOf(id: string): Rect {
  // Where the scene stands it: the theme's own spot, else the shipped map's.
  const pos = pokemonTheme.buildingPositions?.[id] ?? VILLAGE.buildings.find((b) => b.id === id)!;
  const [w, h] = pngSize(pokemonTheme.getBuildingImage(id));
  return { x: pos.x - w / 2, y: pos.y - h, w, h };
}

describe('pokemonTheme heroes', () => {
  test('every class and colour has a four-way walker and a portrait', () => {
    for (const unit of HERO_CLASSES) {
      for (const color of HERO_COLORS) {
        const cfg = pokemonTheme.getHeroConfig(color, unit);
        expect(pngSize(`assets/themes/pokemon/heroes/${unit}-${color}.png`)).toEqual([16 * 12, 32]);
        expect(cfg.directional).toBeDefined();
        expect(pngSize(pokemonTheme.getHeroPreview(color, unit).url)).toEqual([96, 96]);
      }
    }
    expect(pokemonTheme.getHeroConfig('red', 'pawn', 'codex').idleKey).toBe('hero-rocket');
  });

  test('walk cycles stay inside each direction’s three frames', () => {
    const dir = pokemonTheme.getHeroConfig('red', 'warrior').directional!;
    for (const [facing, frames] of Object.entries(dir.walk)) {
      const stand = dir.stand[facing as keyof typeof dir.stand];
      for (const f of frames) expect(f - stand).toBeGreaterThanOrEqual(0);
      for (const f of frames) expect(f - stand).toBeLessThan(3);
    }
  });

  test('a partner is chosen from the agent id, and stays put across calls', () => {
    const a = pokemonTheme.getPartner!('session-a');
    expect(a).toEqual(pokemonTheme.getPartner!('session-a'));
    const keys = new Set(Array.from({ length: 64 }, (_, i) => pokemonTheme.getPartner!(`session-${i}`)!.textureKey));
    expect(keys.size).toBeGreaterThan(10);
  });
});

describe('pokemonTheme buildings', () => {
  test('door overlays match their building image exactly', () => {
    for (const id of Object.keys(POKEMON_SHEET.buildings.door)) {
      expect(pokemonTheme.hasOpenDoorOverlay?.(id)).toBe(true);
      const size = pngSize(pokemonTheme.getBuildingImage(id));
      expect(pngSize(`assets/themes/pokemon/buildings/${id}-open.png`)).toEqual(size);
    }
  });

  test('every building is renamed, and enclosures keep their interior inside the fence', () => {
    for (const def of BUILDING_DEFS) expect(pokemonTheme.getBuildingLabel?.(def.id)).toBeTruthy();
    for (const [id, [ix, iy, iw, ih]] of Object.entries(POKEMON_SHEET.buildings.interior)) {
      const [w, h] = pngSize(pokemonTheme.getBuildingImage(id));
      expect(ix).toBeGreaterThan(0);
      expect(iy).toBeGreaterThan(0);
      expect(ix + iw).toBeLessThan(w);
      expect(iy + ih).toBeLessThan(h);
    }
  });

  test('buildings stand ≥48px clear of each other, on the 32px road grid', () => {
    const ids = BUILDING_DEFS.map((d) => d.id);
    for (const id of ids) {
      const pos = pokemonTheme.buildingPositions?.[id];
      if (pos !== undefined) expect(pos.x % 32).toBe(0);
    }
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = rectOf(ids[i]!);
        const b = rectOf(ids[j]!);
        const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
        const gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
        expect(Math.max(gapX, gapY)).toBeGreaterThanOrEqual(48);
      }
    }
  });
});

describe('pokemonTheme scenery', () => {
  test('the art-size table matches the baked PNGs', () => {
    const animated = POKEMON_SHEET.scenery.animated as Record<string, { frameWidth: number; frameHeight: number; frames: number }>;
    for (const [key, size] of Object.entries(POKEMON_SHEET.scenery.artSize)) {
      const [w, h] = pngSize(`assets/themes/pokemon/scenery/${key}.png`);
      const frames = animated[key]?.frames ?? 1;
      expect([w / frames, h]).toEqual([...size]);
    }
  });
});

describe('pokemon chatter', () => {
  test('every mood has lines short enough for the bubble', () => {
    for (const lines of Object.values(POKEMON_CHATTER)) {
      expect(lines.length).toBeGreaterThan(3);
      for (const line of lines) expect(line.length).toBeLessThanOrEqual(34);
    }
  });
});
