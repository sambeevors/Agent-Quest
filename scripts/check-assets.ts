#!/usr/bin/env bun
/**
 * Static verification that every asset path the game loads — the town, the
 * trainers, their portraits and Pokémon, and the panel chrome — actually
 * exists under client/public/. Run in CI or pre-commit to catch renames /
 * missing files before a user sees the boot error screen.
 *
 * Usage:
 *   bun run check:assets
 *
 * Exit codes:
 *   0 — all expected assets present
 *   1 — one or more missing
 */
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { imagePreload, portraitUrl, spritesheetPreload } from '../client/src/game/pokemon';
import { ROCKETS, TRAINERS } from '../client/src/naming/trainer-roster';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, '..', 'client', 'public');

interface Expected {
  path: string;    // public-root-relative
  source: string;  // for error output
}

function collectExpected(): Expected[] {
  const out: Expected[] = [
    { path: 'assets/logo.png', source: 'BootScene logo' },
    { path: 'assets/pokemon/ui/box.png', source: 'panel chrome' },
    { path: 'assets/pokemon/ui/plate.png', source: 'panel chrome' },
  ];
  for (const e of imagePreload()) out.push({ path: e.path, source: `image:${e.key}` });
  for (const e of spritesheetPreload()) out.push({ path: e.path, source: `sheet:${e.key}` });
  for (const t of [...TRAINERS, ...ROCKETS]) {
    out.push({ path: portraitUrl(t).replace(/^\//, ''), source: `portrait:${t.title} ${t.name}` });
  }
  return out;
}

function main(): number {
  const expected = collectExpected();

  const seen = new Set<string>();
  const missing: Expected[] = [];
  let checked = 0;

  for (const e of expected) {
    if (seen.has(e.path)) continue;
    seen.add(e.path);
    checked++;
    const full = join(PUBLIC_DIR, e.path);
    if (!existsSync(full)) missing.push(e);
  }

  if (missing.length === 0) {
    console.log(`ok — ${checked} asset path${checked === 1 ? '' : 's'} verified under client/public/`);
    return 0;
  }

  console.error(`FAIL — ${missing.length} of ${checked} expected assets missing:\n`);
  for (const m of missing) {
    console.error(`  [${m.source}] ${m.path}`);
  }
  console.error('\nRestore with:  git checkout -- client/public/assets/pokemon/');
  return 1;
}

process.exit(main());
