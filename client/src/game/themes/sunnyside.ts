import { SUNNYSIDE_SHEET } from './sunnyside-sheet';
import type {
  ArenaNpcSpec,
  HeroPreview,
  HeroSpriteConfig,
  PreloadEntry,
  StaticAssetEntry,
  ThemeManifest,
  UnitColor,
  UnitSource,
  UnitType,
} from './types';

/**
 * Sunnyside World theme ("Sunnyside World" by Daniel Diggle, itch.io).
 *
 * Nothing here reads the pack directly — every PNG under
 * assets/themes/sunnyside/ is baked by scripts/bake-sunnyside/ from the
 * purchased pack zips: hero sheets are composited (base + hair + tools,
 * shirt palette-swapped per HeroColor), buildings are assembled from the
 * pack's modular pieces at one consistent zoom, and the terrain sheets are
 * laid out to the exact shapes the renderers expect. `SUNNYSIDE_SHEET` is
 * the bake's generated metadata (frame counts, rows, door heights).
 */

const BASE = 'assets/themes/sunnyside';

const SHEET = SUNNYSIDE_SHEET.heroes;
const GOBLIN = SUNNYSIDE_SHEET.goblin;
const SKELETON = SUNNYSIDE_SHEET.skeleton;

/**
 * How large a hero renders. The baked frames are 96x64 with an ~15px-tall
 * character inside, so unlike Tiny Swords (192px frames, scale 0.55) the
 * scale is above 1. MapConfig-saved scales are rebased in registry.ts.
 */
const HERO_SCALE = 1.6;

/**
 * Doorway height every building is normalised to, in baked pixels. The bake
 * composes all buildings at one zoom, so unlike Tiny Swords the per-building
 * values differ by design (a castle gate IS taller than a hut door), not by
 * accident of the source art. The scale is chosen so a doorway renders at
 * ~1.15x hero height.
 */
const REFERENCE_DOOR = 52;
const BUILDING_SCALE = 0.58;

const DOOR_HEIGHT: Record<string, number> = SUNNYSIDE_SHEET.buildings.doorHeight;

/** Stationary animation per agent state, where a sensible mapping exists.
 * git → watering: publishing sends the hero to the Farm, where it works the
 * land rather than pantomiming a scribe. */
const ACTIVITY_ANIMS: ReadonlyArray<{ state: string; anim: keyof typeof SHEET.anims; frameRate: number }> = [
  { state: 'editing', anim: 'hammering', frameRate: 14 },
  { state: 'bash', anim: 'attack', frameRate: 10 },
  { state: 'debugging', anim: 'doing', frameRate: 8 },
  { state: 'git', anim: 'watering', frameRate: 7 },
  { state: 'waiting', anim: 'waiting', frameRate: 6 },
];

function rowIndices(row: number, frames: number, columns: number = SHEET.columns): number[] {
  return Array.from({ length: frames }, (_, i) => row * columns + i);
}

function humanKey(color: UnitColor, unit: UnitType): string {
  return `hero-${unit}-${color}`;
}

type AnimTable = Record<string, { row: number; frames: number }>;

function buildConfig(textureKey: string, anims: AnimTable): HeroSpriteConfig {
  const idle = anims['idle']!;
  const walk = anims['walk']!;
  const extraAnims: Record<string, { frameIndices: number[]; frameRate: number }> = {};
  for (const { state, anim, frameRate } of ACTIVITY_ANIMS) {
    const spec = anims[anim];
    if (spec !== undefined) {
      extraAnims[state] = { frameIndices: rowIndices(spec.row, spec.frames), frameRate };
    }
  }
  return {
    idleKey: textureKey,
    runKey: textureKey,
    idleFrames: idle.frames,
    runFrames: walk.frames,
    idleFrameIndices: rowIndices(idle.row, idle.frames),
    runFrameIndices: rowIndices(walk.row, walk.frames),
    facesLeft: false,
    tint: null,
    extraAnims,
  };
}

export const sunnysideTheme: ThemeManifest = {
  id: 'sunnyside',
  name: 'Sunnyside World',
  heroScale: HERO_SCALE,
  buildingScale: BUILDING_SCALE,

  getHeroPreload(): PreloadEntry[] {
    const entries: PreloadEntry[] = [];
    for (const unit of SHEET.classes) {
      for (const color of SHEET.colors) {
        entries.push({
          key: humanKey(color, unit),
          path: `${BASE}/heroes/${unit}-${color}.png`,
          frameWidth: SHEET.frameWidth,
          frameHeight: SHEET.frameHeight,
        });
      }
    }
    entries.push({
      key: 'hero-goblin',
      path: `${BASE}/heroes/goblin.png`,
      frameWidth: SHEET.frameWidth,
      frameHeight: SHEET.frameHeight,
    });
    return entries;
  },

  getHeroConfig(color: UnitColor, unit: UnitType, source?: UnitSource): HeroSpriteConfig {
    if (source === 'codex') {
      return buildConfig('hero-goblin', GOBLIN.anims as AnimTable);
    }
    return buildConfig(humanKey(color, unit), SHEET.anims as AnimTable);
  },

  getHeroPreview(color: UnitColor, unit: UnitType, source?: UnitSource): HeroPreview {
    const url =
      source === 'codex'
        ? `/${BASE}/heroes/portrait-goblin.png`
        : `/${BASE}/heroes/portrait-${unit}-${color}.png`;
    // Portraits are baked as single square frames, so the CSS crop shows the
    // whole image — no sheet geometry to communicate.
    return { url, sheetColumns: 1, sheetRows: 1, frameWidth: 96, frameHeight: 96 };
  },

  terrain: {
    tilesetKey: 'terrain-grass',
    path: `${BASE}/terrain/grass.png`,
    tileSize: 64,
    grassFrame: 0,
    road: {
      tilesetKey: 'terrain-road',
      columns: 6,
      blockFrame: 0,
      gravelFrame: 4,
      tuftFrame: 5,
    },
  },

  getBuildingImage(id: string): string {
    return `${BASE}/buildings/${id}.png`;
  },

  getBuildingScale(id: string): number {
    const door = DOOR_HEIGHT[id];
    if (door === undefined) return BUILDING_SCALE;
    return BUILDING_SCALE * (REFERENCE_DOOR / door);
  },

  getChimneyAnchor(id: string): readonly [number, number] | null {
    return (SUNNYSIDE_SHEET.buildings.chimney as Record<string, readonly [number, number]>)[id] ?? null;
  },

  getBuildingInterior(id: string): readonly [number, number, number, number] | null {
    return (SUNNYSIDE_SHEET.buildings.interior as Record<string, readonly [number, number, number, number]>)[id] ?? null;
  },

  getBuildingCrops(id: string): ReadonlyArray<readonly [number, number]> | null {
    return (SUNNYSIDE_SHEET.buildings.crops as Record<string, ReadonlyArray<readonly [number, number]>>)[id] ?? null;
  },

  getArenaNpcs(): ArenaNpcSpec[] {
    // Both sheets share the hero frame format and face right natively; the
    // scene flips them to face the heroes' side of the yard.
    const goblinIdle = GOBLIN.anims.idle;
    const goblinAttack = GOBLIN.anims.attack;
    return [
      {
        textureKey: 'hero-goblin',
        facesLeft: false,
        idle: { frameIndices: rowIndices(goblinIdle.row, goblinIdle.frames), frameRate: 8 },
        attack: { frameIndices: rowIndices(goblinAttack.row, goblinAttack.frames), frameRate: 10 },
      },
      {
        textureKey: 'npc-skeleton',
        facesLeft: false,
        idle: { frameIndices: rowIndices(SKELETON.anims.idle.row, SKELETON.anims.idle.frames, SKELETON.columns), frameRate: 8 },
        attack: { frameIndices: rowIndices(SKELETON.anims.attack.row, SKELETON.anims.attack.frames, SKELETON.columns), frameRate: 10 },
      },
    ];
  },

  getStaticAssetPreload(): StaticAssetEntry[] {
    const entries: StaticAssetEntry[] = [
      // Terrain sheets beyond the grass tileset (which BootScene loads from
      // `terrain` above). The water key keeps its 'water' substring — the
      // lake keep-out in game/data/water.ts matches on it.
      { key: 'terrain-road', path: `${BASE}/terrain/road.png`, frameWidth: 64, frameHeight: 64 },
      { key: 'terrain-water', path: `${BASE}/terrain/water.png`, frameWidth: 64, frameHeight: 64 },
      { key: 'terrain-meadow', path: `${BASE}/terrain/meadow.png` },
      { key: 'terrain-bridge', path: `${BASE}/terrain/bridge.png` },
      // Construction sites.
      { key: 'site-scaffold', path: `${BASE}/buildings/site-scaffold.png` },
      { key: 'house-blue', path: `${BASE}/buildings/house-blue.png` },
      { key: 'house-yellow', path: `${BASE}/buildings/house-yellow.png` },
      { key: 'house-red', path: `${BASE}/buildings/house-red.png` },
      { key: 'house-purple', path: `${BASE}/buildings/house-purple.png` },
      // Enclosure floors — drawn beneath the y-sorted world by Building so
      // heroes stand ON the arena's earth and the farm's soil rows.
      { key: 'building-arena-ground', path: `${BASE}/buildings/arena-ground.png` },
      { key: 'building-farm-ground', path: `${BASE}/buildings/farm-ground.png` },
      // The arena's resident sparring partner (the goblin sheet is already a
      // hero preload). Spritesheet geometry from the bake metadata.
      {
        key: 'npc-skeleton',
        path: `${BASE}/heroes/skeleton.png`,
        frameWidth: SUNNYSIDE_SHEET.skeleton.frameWidth,
        frameHeight: SUNNYSIDE_SHEET.skeleton.frameHeight,
      },
      // Static scenery. Foliage holds still by design — only creatures
      // (the animal strips below) animate.
      { key: 'tree-1', path: `${BASE}/scenery/tree-1.png` },
      { key: 'tree-2', path: `${BASE}/scenery/tree-2.png` },
      { key: 'tree-3', path: `${BASE}/scenery/tree-3.png` },
      { key: 'tree-4', path: `${BASE}/scenery/tree-4.png` },
      { key: 'mushroom-1', path: `${BASE}/scenery/mushroom-1.png` },
      { key: 'mushroom-2', path: `${BASE}/scenery/mushroom-2.png` },
      { key: 'mushroom-3', path: `${BASE}/scenery/mushroom-3.png` },
      { key: 'mushroom-4', path: `${BASE}/scenery/mushroom-4.png` },
      { key: 'bush-1', path: `${BASE}/scenery/bush-1.png` },
      { key: 'bush-2', path: `${BASE}/scenery/bush-2.png` },
      { key: 'bush-3', path: `${BASE}/scenery/bush-3.png` },
      { key: 'rock-1', path: `${BASE}/scenery/rock-1.png` },
      { key: 'rock-2', path: `${BASE}/scenery/rock-2.png` },
      { key: 'rock-3', path: `${BASE}/scenery/rock-3.png` },
      { key: 'rock-4', path: `${BASE}/scenery/rock-4.png` },
      { key: 'rock-5', path: `${BASE}/scenery/rock-5.png` },
      { key: 'flower-1', path: `${BASE}/scenery/flower-1.png` },
      { key: 'flower-2', path: `${BASE}/scenery/flower-2.png` },
      { key: 'flower-3', path: `${BASE}/scenery/flower-3.png` },
      { key: 'stump-1', path: `${BASE}/scenery/stump-1.png` },
      { key: 'stump-2', path: `${BASE}/scenery/stump-2.png` },
    ];
    // Animated scenery + VFX carry their frame sizes from the bake metadata.
    for (const [key, spec] of Object.entries(SUNNYSIDE_SHEET.scenery.animated)) {
      entries.push({
        key,
        path: `${BASE}/scenery/${key}.png`,
        frameWidth: spec.frameWidth,
        frameHeight: spec.frameHeight,
      });
    }
    for (const [key, spec] of Object.entries(SUNNYSIDE_SHEET.vfx)) {
      entries.push({
        key: `vfx-${key}`,
        path: `${BASE}/vfx/${key}.png`,
        frameWidth: spec.frameWidth,
        frameHeight: spec.frameHeight,
      });
    }
    return entries;
  },

  postLoadHook(scene): void {
    // Looping animations for the creatures and the chimney smoke. Created
    // once here (the anims manager is global) so renderers just play them.
    // Everything botanical is baked static, so the animated table is only
    // the animal strips.
    for (const [key, spec] of Object.entries(SUNNYSIDE_SHEET.scenery.animated)) {
      if (!scene.anims.exists(`${key}-anim`) && scene.textures.exists(key)) {
        scene.anims.create({
          key: `${key}-anim`,
          frames: scene.anims.generateFrameNumbers(key, { start: 0, end: spec.frames - 1 }),
          frameRate: 5,
          repeat: -1,
        });
      }
    }
    const smoke = SUNNYSIDE_SHEET.vfx.chimneysmoke;
    if (!scene.anims.exists('vfx-chimneysmoke-anim') && scene.textures.exists('vfx-chimneysmoke')) {
      scene.anims.create({
        key: 'vfx-chimneysmoke-anim',
        frames: scene.anims.generateFrameNumbers('vfx-chimneysmoke', { start: 0, end: smoke.frames - 1 }),
        frameRate: 10,
        repeat: -1,
      });
    }
  },
};
