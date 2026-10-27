import { POKEMON_SHEET } from './pokemon-sheet';
import { POKEMON_CHATTER } from './pokemon-chatter';
import type {
  ArenaNpcSpec,
  DirectionalAnims,
  Facing,
  FrameExtent,
  HeroPreview,
  HeroSpriteConfig,
  PartnerSpec,
  PreloadEntry,
  SceneryStyle,
  StaticAssetEntry,
  ThemeManifest,
  UnitColor,
  UnitSource,
  UnitType,
} from './types';

/**
 * Pokémon theme — a Kanto town out of FireRed/LeafGreen.
 *
 * Educational fork only: the art is Nintendo / Game Freak / The Pokémon
 * Company's. Every PNG under assets/themes/pokemon/ is baked by
 * scripts/bake-pokemon/ from the pret/pokefirered decompilation (buildings
 * cropped from real towns, terrain composed from the general tileset,
 * trainers in their in-game palettes) and PokeAPI/sprites (Gen III icons for
 * the Pokémon). `POKEMON_SHEET` is the bake's generated metadata.
 *
 * Heroes are trainers: a class picks a roster (famous faces, aces, route
 * trainers) and the hero colour picks one trainer from it. Codex sessions are
 * Team Rocket. Each trainer is trailed by a partner Pokémon chosen from its
 * agent id, so the partner — like the hero's name — survives reloads.
 */

const BASE = 'assets/themes/pokemon';
const SHEET = POKEMON_SHEET.heroes;
const PKMN = POKEMON_SHEET.pokemon;

/** Map art is baked at x2 (one 16px metatile = 32 world px); trainers are
 * native 16x32 frames, so they take the same x2 here. */
const HERO_SCALE = 2;

const HERO_EXTENT: FrameExtent = { frameHeight: SHEET.frameHeight, headY: SHEET.headY, footY: SHEET.footY };

/** Sheet layout from overworld.walker_sheet: 3 frames (stand, step, step)
 * per direction, in this order. */
const DIRECTION_ROW: Record<Facing, number> = { down: 0, up: 1, left: 2, right: 3 };

function directional(): DirectionalAnims {
  const stand = {} as Record<Facing, number>;
  const walk = {} as Record<Facing, number[]>;
  for (const [dir, i] of Object.entries(DIRECTION_ROW) as Array<[Facing, number]>) {
    const s = i * 3;
    stand[dir] = s;
    // Step, stand, other step, stand — FireRed's four-beat walk.
    walk[dir] = [s + 1, s, s + 2, s];
  }
  return {
    stand,
    walk,
    // Working trainers mark time on the spot; resting and waiting ones stand.
    busy: { states: ['reading', 'editing', 'bash', 'debugging', 'git', 'reviewing', 'thinking'], frameRate: 4 },
  };
}

const DIRECTIONAL = directional();

function heroKey(color: UnitColor, unit: UnitType, source?: UnitSource): string {
  return source === 'codex' ? 'hero-rocket' : `hero-${unit}-${color}`;
}

/** FNV-1a with a final avalanche — agent ids differ only in their tail. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

const LABELS: Record<string, string> = POKEMON_SHEET.labels;

const SCENERY: SceneryStyle = {
  scale: 1,
  // Tile art sits on one pixel grid — no size jitter, and no mirroring
  // (FireRed's trees are lit from the left on purpose).
  jitter: 0,
  flip: false,
  // Kanto towns are kept tidy; the woods stay, the meadow clutter thins.
  density: 0.65,
  artSize: POKEMON_SHEET.scenery.artSize as unknown as Record<string, readonly [number, number]>,
};

export const pokemonTheme: ThemeManifest = {
  id: 'pokemon',
  name: 'Pokémon FireRed',
  heroScale: HERO_SCALE,
  buildingScale: 1,
  // village.json stores heroScale 0.4 against the Tiny Swords baseline.
  savedScaleFactor: HERO_SCALE / 0.4,
  scenery: SCENERY,
  critterScale: 0.75,
  // The top row spreads out for the 7-block Gym, Lab and School (64px apart,
  // x on the 32px road grid) and the tall grass steps west to clear the Gym.
  buildingPositions: {
    watchtower: { x: 1088, y: 704 },
    castle: { x: 1376, y: 704 },
    library: { x: 1664, y: 704 },
    arena: { x: 800, y: 896 },
  },

  getHeroPreload(): PreloadEntry[] {
    const entries: PreloadEntry[] = [];
    for (const unit of SHEET.classes) {
      for (const color of SHEET.colors) {
        entries.push({
          key: heroKey(color, unit),
          path: `${BASE}/heroes/${unit}-${color}.png`,
          frameWidth: SHEET.frameWidth,
          frameHeight: SHEET.frameHeight,
        });
      }
    }
    entries.push({ key: 'hero-rocket', path: `${BASE}/heroes/rocket.png`, frameWidth: SHEET.frameWidth, frameHeight: SHEET.frameHeight });
    return entries;
  },

  getHeroConfig(color: UnitColor, unit: UnitType, source?: UnitSource): HeroSpriteConfig {
    const key = heroKey(color, unit, source);
    return {
      idleKey: key,
      runKey: key,
      idleFrames: 1,
      runFrames: 4,
      idleFrameIndices: [DIRECTIONAL.stand.down],
      runFrameIndices: DIRECTIONAL.walk.down,
      facesLeft: false,
      tint: null,
      extent: HERO_EXTENT,
      directional: DIRECTIONAL,
    };
  },

  getHeroPreview(color: UnitColor, unit: UnitType, source?: UnitSource): HeroPreview {
    const url = source === 'codex'
      ? `/${BASE}/heroes/portrait-rocket.png`
      : `/${BASE}/heroes/portrait-${unit}-${color}.png`;
    return { url, sheetColumns: 1, sheetRows: 1, frameWidth: 96, frameHeight: 96 };
  },

  terrain: {
    tilesetKey: 'terrain-grass',
    path: `${BASE}/terrain/grass.png`,
    tileSize: 64,
    grassFrame: 0,
    road: { tilesetKey: 'terrain-road', columns: 6, blockFrame: 0, gravelFrame: 4, tuftFrame: 5 },
  },

  getBuildingImage(id: string): string {
    return `${BASE}/buildings/${id}.png`;
  },

  getBuildingScale(): number {
    return 1;
  },

  getBuildingLabel(id: string): string | null {
    return LABELS[id] ?? null;
  },

  hasOpenDoorOverlay(id: string): boolean {
    return id in POKEMON_SHEET.buildings.door;
  },

  getBuildingInterior(id: string): readonly [number, number, number, number] | null {
    return (POKEMON_SHEET.buildings.interior as Record<string, readonly [number, number, number, number]>)[id] ?? null;
  },

  getBuildingCrops(id: string): ReadonlyArray<readonly [number, number]> | null {
    return (POKEMON_SHEET.buildings.crops as Record<string, ReadonlyArray<readonly [number, number]>>)[id] ?? null;
  },

  getArenaNpcs(): ArenaNpcSpec[] {
    // Wild Pokémon in the tall grass. Icons face left natively — toward the
    // trainers on the yard's west side. Frames: 0 rest, 1 hop, 2 lunge,
    // 3 lunge with the hit flash.
    return PKMN.arena.map((w) => ({
      textureKey: `npc-${w.key}`,
      facesLeft: true,
      idle: { frameIndices: [0, 1], frameRate: 3 },
      attack: { frameIndices: [0, 2, 3, 2, 0, 1], frameRate: 7 },
      extent: { frameHeight: 32, headY: w.headY, footY: w.footY },
      scale: 0.75,
    }));
  },

  getPartner(agentId: string): PartnerSpec | null {
    const dex = PKMN.partners[hash(agentId) % PKMN.partners.length]!;
    return {
      textureKey: `partner-${dex}`,
      frameIndices: [0, 1],
      extent: PKMN.partnerExtent,
      facesLeft: true,
      scale: 0.75,
    };
  },

  featureScale(textureKey: string, savedScale: number): number {
    // Lake stones were placed at Sunnyside's 0.45; this theme's scenery is
    // baked to render at 1. The jetty already saves 1.
    return textureKey.startsWith('rock-') ? 1 : savedScale;
  },

  chatter: POKEMON_CHATTER,

  getStaticAssetPreload(): StaticAssetEntry[] {
    const entries: StaticAssetEntry[] = [
      { key: 'terrain-road', path: `${BASE}/terrain/road.png`, frameWidth: 64, frameHeight: 64 },
      { key: 'terrain-water', path: `${BASE}/terrain/water.png`, frameWidth: 64, frameHeight: 64 },
      { key: 'terrain-shore', path: `${BASE}/terrain/shore.png`, frameWidth: 64, frameHeight: 64 },
      { key: 'terrain-meadow', path: `${BASE}/terrain/meadow.png` },
      { key: 'terrain-bridge', path: `${BASE}/terrain/bridge.png` },
      { key: 'building-arena-ground', path: `${BASE}/buildings/arena-ground.png` },
      { key: 'building-farm-ground', path: `${BASE}/buildings/farm-ground.png` },
    ];
    for (const id of Object.keys(POKEMON_SHEET.buildings.door)) {
      entries.push({ key: `building-${id}-open`, path: `${BASE}/buildings/${id}-open.png` });
    }
    for (const key of Object.keys(POKEMON_SHEET.scenery.artSize)) {
      const anim = (POKEMON_SHEET.scenery.animated as Record<string, { frameWidth: number; frameHeight: number }>)[key];
      entries.push(anim !== undefined
        ? { key, path: `${BASE}/scenery/${key}.png`, frameWidth: anim.frameWidth, frameHeight: anim.frameHeight }
        : { key, path: `${BASE}/scenery/${key}.png` });
    }
    const duck = POKEMON_SHEET.scenery.animated.duck;
    entries.push({ key: 'duck', path: `${BASE}/scenery/duck.png`, frameWidth: duck.frameWidth, frameHeight: duck.frameHeight });
    for (const w of PKMN.arena) {
      entries.push({ key: `npc-${w.key}`, path: `${BASE}/heroes/${w.key}.png`, frameWidth: 32, frameHeight: 32 });
    }
    for (const dex of PKMN.partners) {
      entries.push({ key: `partner-${dex}`, path: `${BASE}/partners/${dex}.png`, frameWidth: 32, frameHeight: 32 });
    }
    return entries;
  },

  postLoadHook(scene): void {
    // The wild Pokémon and the swimmer hop in place, like a party icon.
    for (const key of Object.keys(POKEMON_SHEET.scenery.animated)) {
      if (!scene.anims.exists(`${key}-anim`) && scene.textures.exists(key)) {
        scene.anims.create({
          key: `${key}-anim`,
          frames: scene.anims.generateFrameNumbers(key, { start: 0, end: 1 }),
          frameRate: 3,
          repeat: -1,
        });
      }
    }
  },
};
