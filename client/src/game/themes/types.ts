export type ThemeId = 'sunnyside';

export type UnitType = 'warrior' | 'archer' | 'pawn';
/** Sunnyside hero sheets are baked per hero colour (shirt palette swap), so
 * every logical HeroColor has its own sprite variant. */
export type UnitColor =
  | 'blue' | 'yellow' | 'red' | 'black' | 'purple'
  | 'teal' | 'orange' | 'green';
/** Which provider a session came from — Codex sessions render as goblins. */
export type UnitSource = 'claude' | 'codex';

export interface PreloadEntry {
  key: string;
  path: string;
  frameWidth: number;
  frameHeight: number;
}

/** Any asset BootScene needs to preload beyond heroes/buildings/terrain —
 * bushes, rocks, trees, stumps, decorative houses. When frameWidth is
 * undefined the file is loaded as a plain image; when set it's loaded as
 * a spritesheet. */
export interface StaticAssetEntry {
  key: string;
  path: string;
  frameWidth?: number;
  frameHeight?: number;
}

export interface HeroSpriteConfig {
  idleKey: string;
  runKey: string;
  /** Number of frames that the idle animation loops over. */
  idleFrames: number;
  /** Number of frames that the run animation loops over. */
  runFrames: number;
  /**
   * Explicit frame indices for the idle animation. When set, overrides the
   * contiguous 0..idleFrames-1 range. Used by sheets where frames of the
   * same animation are not contiguous (e.g. combined sheets where rows are
   * animations and columns are frames — we need to offset by sheetCols).
   */
  idleFrameIndices?: number[];
  /** Explicit frame indices for the run animation — see idleFrameIndices. */
  runFrameIndices?: number[];
  /** Set true for sprites that natively face left (we flipX by default). */
  facesLeft: boolean;
  /** Phaser tint (0xRRGGBB) applied via setTint on the sprite, or null. */
  tint: number | null;
  /**
   * Optional stationary animations keyed by what the hero is doing —
   * an AgentActivity ('editing', 'bash', …) or the pseudo-state 'waiting'.
   * When a hero is parked at a building, HeroSprite plays the entry for its
   * current state if one exists, and falls back to idle otherwise. Frames
   * index into the same texture as idleKey.
   */
  extraAnims?: Record<string, { frameIndices: number[]; frameRate: number }>;
}

/** One arena NPC: which texture it uses and how it idles and fights. Frame
 * indices address the texture's spritesheet directly (row-major). */
export interface ArenaNpcSpec {
  textureKey: string;
  /** Natively-left-facing art is flipped so it faces right by default. */
  facesLeft: boolean;
  idle: { frameIndices: number[]; frameRate: number };
  attack: { frameIndices: number[]; frameRate: number };
}

/** Static preview of a hero's idle sheet — used by React UI (PartyBar). */
export interface HeroPreview {
  /** URL relative to the public root (leading slash). */
  url: string;
  /** Number of frames in one row of the idle sheet (for CSS background-size). */
  sheetColumns: number;
  /** Number of rows in the combined sheet (for CSS background-size). */
  sheetRows: number;
  /** Native frame dimensions in the sheet. */
  frameWidth: number;
  frameHeight: number;
}

/** Background tileset used by TerrainRenderer for the main village ground.
 * TerrainRenderer is mostly procedural (roads/forest/lake/noise) but the
 * base grass fill is drawn as a tiled sprite from one frame of a tileset. */
/**
 * The packed-earth surface roads are drawn from. The bake pipeline lays the
 * pack's dirt tiles out in this exact sheet shape (see
 * scripts/bake-sunnyside/terrain.py), so the theme just preloads it.
 */
export interface RoadTilesetConfig {
  /** Phaser texture key the road sheet is registered under. */
  tilesetKey: string;
  /** Columns in the generated sheet, needed to walk frame indices by row. */
  columns: number;
  /**
   * Frame index of the top-left tile of the 4x4 block of edge tiles. Rows run
   * top-edge / middle / bottom-edge / both; columns left / middle / right /
   * both.
   */
  blockFrame: number;
  /** Frame holding loose gravel, sprinkled over a road's surface. */
  gravelFrame: number;
  /** Frame holding grass tufts, sprinkled along a road's verge. */
  tuftFrame: number;
}

export interface TerrainConfig {
  /** Phaser texture key under which the tileset is registered. */
  tilesetKey: string;
  /** Path relative to the public root (no leading slash). */
  path: string;
  /** Square tile size in px. */
  tileSize: number;
  /** Frame index (row-major) of the "main grass" tile used as ground fill. */
  grassFrame: number;
  /** Surface roads are tiled from. Absent means the theme cannot draw roads. */
  road?: RoadTilesetConfig;
}

export interface ThemeManifest {
  id: ThemeId;
  name: string;
  /** Base scale applied to hero sprites. MapConfig-saved values are
   * rebased against the Tiny Swords baseline (0.5) — see
   * rebaseSavedScale() in registry.ts. */
  heroScale: number;
  getHeroPreload(): PreloadEntry[];
  getHeroConfig(color: UnitColor, unit: UnitType, source?: UnitSource): HeroSpriteConfig;
  getHeroPreview(color: UnitColor, unit: UnitType, source?: UnitSource): HeroPreview;
  /** Background tileset for TerrainRenderer. When absent, the renderer
   * falls back to its built-in procedural grass tile. */
  terrain?: TerrainConfig;
  /** PNG path for a functional building (id from BUILDING_DEFS).
   * All themes are required to provide imagery for every building id. */
  getBuildingImage(id: string): string;
  /**
   * World scale for building art. The scale a building actually renders at is
   * `getBuildingScale`, which starts here; this is exposed separately for
   * anything that needs a representative figure without naming a building.
   */
  buildingScale: number;
  /**
   * Scale for one building's PNG. A theme whose building art is all drawn at
   * the same zoom should return `buildingScale` for every id and let the PNG's
   * own dimensions decide what looks big. It returns something else only when
   * doorway heights differ across buildings (by design or by accident of the
   * source art) and the rendered doorway should still come out one size.
   */
  getBuildingScale(id: string): number;
  /** Decorations, decorative houses, trees, stumps — every static/sprite
   * asset BootScene used to hardcode. */
  getStaticAssetPreload(): StaticAssetEntry[];
  /**
   * Where chimney smoke rises from on a building, in the building image's own
   * pixels (origin top-left), or null when the theme has no anchor for the
   * id. Themes without smoke omit the method entirely.
   */
  getChimneyAnchor?(id: string): readonly [number, number] | null;
  /**
   * For buildings heroes physically enter (fenced enclosures like the arena
   * and the farm): the [x, y, w, h] region of the building image, in its own
   * pixels, where stationed heroes may stand. Null for ordinary buildings,
   * whose heroes gather at the door instead. An enclosure additionally ships
   * a `<imageKey>-ground` texture (its floor), drawn beneath the y-sorted
   * world so heroes walk over it while the fence still overlaps their feet.
   */
  getBuildingInterior?(id: string): readonly [number, number, number, number] | null;
  /**
   * Points of interest inside an enclosure, in the building image's own
   * pixels: the centre of every tilled bed in the farm, so a hero can work a
   * crop rather than stand anywhere on the soil. Baked from the same
   * constants that paint the beds, so the two can't drift. Null for
   * buildings that have none.
   */
  getBuildingCrops?(id: string): ReadonlyArray<readonly [number, number]> | null;
  /**
   * The arena's resident sparring partners — NPC sprites the scene places
   * inside the arena's interior. They idle when the yard is empty and fight
   * while a hero is stationed there (ambience driven by real state, like
   * chimney smoke). Absent when the theme has no arena cast.
   */
  getArenaNpcs?(): ArenaNpcSpec[];
  /** Optional post-load hook, called from BootScene.create() after the
   * Phaser loader has finished. Useful for canvas-based slicing: e.g.
   * turn one combined tree atlas into 4 separate `tree-1..4` textures. */
  postLoadHook?(scene: import('phaser').Scene): void;
}
