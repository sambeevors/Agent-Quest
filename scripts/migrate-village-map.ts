#!/usr/bin/env bun
/**
 * One-off migration of server/data/map/village.json from Tiny Swords keys to
 * the Sunnyside theme. Geometry (world size, building positions, spawn,
 * settings) is untouched — only tileset keys, frame indices and decoration
 * texture keys are rewritten.
 *
 * Deterministic: grass and water cells pick their variant frame from a hash
 * of their grid position, so re-running produces the same file.
 *
 * Usage: bun run scripts/migrate-village-map.ts
 */
import { resolve } from 'node:path';
import type { MapConfig, DecorationInstance } from '../server/src/map/types';

const MAP_PATH = resolve(import.meta.dir, '../server/data/map/village.json');

/** Deterministic 0..99 for a grid cell. */
function cellHash(col: number, row: number): number {
  let h = (col * 73856093) ^ (row * 19349663);
  h = (h ^ (h >>> 13)) * 0x5bd1e995;
  return Math.abs(h >>> 0) % 100;
}

/** Grass frame: mostly plain, sprinkled with the decorated variants. */
function grassFrame(col: number, row: number): number {
  const r = cellHash(col, row);
  if (r < 72) return 0;
  if (r < 80) return 1;
  if (r < 88) return 2;
  if (r < 94) return 3;
  return 4;
}

/** Water frame: mostly calm, some wave variants, the odd sparkle. */
function waterFrame(col: number, row: number): number {
  const r = cellHash(col * 7 + 3, row * 5 + 1);
  if (r < 58) return 0;
  if (r < 72) return 1;
  if (r < 86) return 2;
  if (r < 96) return 3;
  return 4;
}

const ROCK_KEY: Record<string, string> = {
  'terrain-water-rocks-rocks-01': 'rock-4',
  'terrain-water-rocks-rocks-02': 'rock-3',
  'terrain-water-rocks-rocks-03': 'rock-2',
  'terrain-water-rocks-rocks-04': 'rock-5',
};

const map = (await Bun.file(MAP_PATH).json()) as MapConfig;

map.baseTileset = 'terrain-meadow';

for (const [key, cell] of Object.entries(map.terrain)) {
  const [colStr, rowStr] = key.split(',');
  const col = Number(colStr);
  const row = Number(rowStr);
  if (cell.tile.set === 'terrain-water') {
    cell.tile.frame = waterFrame(col, row);
  } else {
    // Every non-water cell in the shipped map is grass of some variant.
    cell.tile = { set: 'terrain-grass', frame: grassFrame(col, row) };
  }
}

const decorations: DecorationInstance[] = [];
for (const d of map.decorations) {
  if (d.textureKey === 'water-bg') {
    decorations.push(d);
    continue;
  }
  const rock = ROCK_KEY[d.textureKey];
  if (rock !== undefined) {
    decorations.push({ ...d, textureKey: rock, frame: undefined, animated: undefined, animation: undefined });
    continue;
  }
  if (d.textureKey === 'terrain-bridge-bridge-all') {
    // The old bridge was one 64px frame of an atlas; the baked bridge is a
    // full 192x128 deck, so the scale drops to keep its footprint.
    decorations.push({
      ...d,
      textureKey: 'terrain-bridge',
      frame: undefined,
      animated: undefined,
      animation: undefined,
      scale: 0.4,
    });
    continue;
  }
  console.warn(`unmapped decoration ${d.textureKey} — dropped`);
}
map.decorations = decorations;

map.meta.updatedAt = Date.now();

await Bun.write(MAP_PATH, `${JSON.stringify(map, null, 2)}\n`);
console.log(
  `migrated ${Object.keys(map.terrain).length} terrain cells and ${map.decorations.length} decorations`,
);
