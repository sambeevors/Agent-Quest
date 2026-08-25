import { resolve } from 'node:path';
import type { MapConfig } from './types';

/**
 * Loads the village — the one map this project ships.
 *
 * The world used to be editable through an in-app tile editor backed by five
 * save slots. That editor is gone: roads and scenery are generated at runtime
 * from whatever buildings are standing, so the only parts of a hand-authored
 * map that still mattered were the ones nobody wanted to change. What remains
 * is a fixed, read-only description of the village, read once and cached.
 */
const MAP_PATH = resolve(import.meta.dir, '../../data/map/village.json');

let cached: Promise<MapConfig | null> | null = null;

async function read(): Promise<MapConfig | null> {
  const file = Bun.file(MAP_PATH);
  if (!(await file.exists())) {
    console.error(`[map] village map missing at ${MAP_PATH} — falling back to procedural terrain`);
    return null;
  }
  try {
    return JSON.parse(await file.text()) as MapConfig;
  } catch (err) {
    console.error(`[map] village map is not valid JSON (${String(err)})`);
    return null;
  }
}

/** The shipped village, or null if the file is missing or unreadable. */
export function loadVillageMap(): Promise<MapConfig | null> {
  cached ??= read();
  return cached;
}
