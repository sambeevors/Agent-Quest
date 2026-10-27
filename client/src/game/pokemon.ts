import { POKEMON_SHEET } from './pokemon-sheet';
import { TOWN_BUILDINGS } from './town/town';
import type { Trainer } from '../naming/hero-names';

/**
 * The art PokéAgent draws with — FireRed trainers, their partner Pokémon,
 * and Cerulean City itself.
 *
 * Educational fork only: the art is Nintendo / Game Freak / The Pokémon
 * Company's. Every PNG under assets/pokemon/ is baked by scripts/bake-pokemon/
 * from the pret/pokefirered decompilation (the town, trainer sprites in their
 * in-game palettes, battle portraits) and PokeAPI/sprites (Gen III party
 * icons for the Pokémon). `POKEMON_SHEET` is the bake's sprite metrics.
 */

export const ASSET_BASE = 'assets/pokemon';

/** The whole world is drawn at x2: a 16px FireRed block is 32 world px, and
 * a 16x32 trainer frame is 32x64. */
export const SPRITE_SCALE = 2;

export type Facing = 'down' | 'up' | 'left' | 'right';

/**
 * The character's vertical extent inside its sprite frame, in native frame
 * pixels (origin top-left) — what the name label hangs from, and the line
 * a sprite depth-sorts and stands on.
 */
export interface FrameExtent {
  frameHeight: number;
  /** Topmost opaque row of the head (hair or hat included). */
  headY: number;
  /** The ground line: the row just below the lowest opaque pixel of the feet. */
  footY: number;
}

const SHEET = POKEMON_SHEET.trainers;
const PKMN = POKEMON_SHEET.pokemon;

export const TRAINER_FRAME = { width: SHEET.frameWidth, height: SHEET.frameHeight };
export const TRAINER_EXTENT: FrameExtent = { frameHeight: SHEET.frameHeight, headY: SHEET.headY, footY: SHEET.footY };

/** Sheet layout from overworld.walker_sheet: 3 frames (stand, step, step)
 * per direction, in this order. */
const DIRECTION_ROW: Record<Facing, number> = { down: 0, up: 1, left: 2, right: 3 };

/** The standing frame for a direction. */
export function standFrame(facing: Facing): number {
  return DIRECTION_ROW[facing] * 3;
}

/** Step, stand, other step, stand — FireRed's four-beat walk. */
export function walkFrames(facing: Facing): number[] {
  const s = standFrame(facing);
  return [s + 1, s, s + 2, s];
}

/** A working trainer marks time on the spot, like an NPC busy at a counter;
 * a resting or waiting one just stands. */
export const BUSY_STATES: readonly string[] = ['reading', 'editing', 'bash', 'debugging', 'git', 'reviewing', 'thinking'];
export const BUSY_FRAME_RATE = 4;

export function trainerTextureKey(trainer: Trainer): string {
  return `trainer-${trainer.sprite}`;
}

export function portraitUrl(trainer: Trainer): string {
  return `/${ASSET_BASE}/portraits/${trainer.portrait}.png`;
}

/** A Pokémon drawn from a two-frame party-icon strip. */
export interface PokemonSpec {
  textureKey: string;
  /** Where the creature stands inside its 32px frame. */
  extent: FrameExtent;
  /** Party icons face left; flipped when the creature heads right. */
  facesLeft: true;
  /** Size relative to a trainer. */
  scale: number;
}

/** The Pokémon that trots at a trainer's heels: the one it sends out last. */
export function partnerSpec(trainer: Trainer): PokemonSpec {
  return { textureKey: `pokemon-${trainer.partner}`, extent: PKMN.partnerExtent, facesLeft: true, scale: 0.75 };
}

/** The Pokémon holding the north end of Nugget Bridge. Frames: 0 rest,
 * 1 hop, 2 lunge, 3 lunge with the hit flash. */
export interface ArenaNpcSpec {
  textureKey: string;
  idle: { frameIndices: number[]; frameRate: number };
  attack: { frameIndices: number[]; frameRate: number };
  extent: FrameExtent;
  scale: number;
}

export const ARENA_NPCS: ArenaNpcSpec[] = PKMN.arena.map((w) => ({
  textureKey: `npc-${w.key}`,
  idle: { frameIndices: [0, 1], frameRate: 3 },
  attack: { frameIndices: [0, 2, 3, 2, 0, 1], frameRate: 7 },
  extent: { frameHeight: 32, headY: w.headY, footY: w.footY },
  scale: 0.75,
}));

export interface SheetEntry {
  key: string;
  path: string;
  frameWidth: number;
  frameHeight: number;
}

export interface ImageEntry {
  key: string;
  path: string;
}

/** Everything BootScene loads as a spritesheet. */
export function spritesheetPreload(): SheetEntry[] {
  const out: SheetEntry[] = SHEET.sprites.map((sprite) => ({
    key: `trainer-${sprite}`,
    path: `${ASSET_BASE}/trainers/${sprite}.png`,
    frameWidth: SHEET.frameWidth,
    frameHeight: SHEET.frameHeight,
  }));
  for (const dex of PKMN.partners) {
    out.push({ key: `pokemon-${dex}`, path: `${ASSET_BASE}/pokemon/${dex}.png`, frameWidth: 32, frameHeight: 32 });
  }
  for (const w of PKMN.arena) {
    out.push({ key: `npc-${w.key}`, path: `${ASSET_BASE}/pokemon/${w.key}.png`, frameWidth: 32, frameHeight: 32 });
  }
  return out;
}

export const TOWN_GROUND_KEY = 'town-ground';
export const TOWN_OVERHEAD_KEY = 'town-overhead';

/** Everything BootScene loads as a plain image: the town's two layers and
 * its open-door frames. */
export function imagePreload(): ImageEntry[] {
  const out: ImageEntry[] = [
    { key: TOWN_GROUND_KEY, path: `${ASSET_BASE}/town/ground.png` },
    { key: TOWN_OVERHEAD_KEY, path: `${ASSET_BASE}/town/overhead.png` },
  ];
  for (const b of Object.values(TOWN_BUILDINGS)) {
    for (const d of b.doorOverlays) out.push({ key: d.key, path: `${ASSET_BASE}/town/${d.key}.png` });
  }
  return out;
}
