/**
 * The world's data model — terrain, decorations, buildings and NPCs, as
 * shipped in `server/data/map/village.json` and served by `GET /api/map`.
 *
 * This is a read-only description of the village. Mirrors
 * `server/src/map/types.ts`; if you change one, change the other.
 *
 * Two things the file deliberately does NOT describe, because both are
 * generated at runtime against whatever buildings actually spawned:
 * roads (see `desire-paths.ts`) and natural scatter (see `scenery.ts`).
 */

export const TILE_SIZE = 64;

export type UnitType = 'warrior' | 'archer' | 'pawn' | 'tnt' | 'torch';
export type UnitColor = 'blue' | 'red' | 'black' | 'yellow' | 'purple';

export interface NpcPlacement {
  id: string;
  unit: UnitType;
  color: UnitColor;
  x: number;
  y: number;
  scale: number;
  wanderRadius: number;
}

export interface MapSettings {
  heroScale: number;
  /** Asset theme the map was authored against. Absent falls back to the default. */
  theme?: string;
}

export interface NpcSpriteManifest {
  unit: UnitType;
  color: UnitColor;
  idleKey: string;
  runKey: string;
  idlePath: string;
  runPath: string;
  idleFrames: number;
  runFrames: number;
  frameWidth: number;
  frameHeight: number;
  /** Explicit frame indices for the idle animation — used by themes (e.g.
   * Tiny Swords CC0) whose sheets combine several animations on different
   * rows. Absent means frames 0..idleFrames-1 are contiguous. */
  idleFrameIndices?: number[];
  /** Same for the run animation. */
  runFrameIndices?: number[];
}

export interface TileRef {
  set: string;
  frame: number;
}

export interface TerrainCell {
  tile: TileRef;
  walkable: boolean;
}

/** Free-placed decoration sprite (tree, water, prop, tower). */
export interface DecorationInstance {
  id: string;
  /** texture key registered by the scene, e.g. "tree-1" */
  textureKey: string;
  /** optional spritesheet frame (for multi-frame decorations like trees) */
  frame?: number;
  x: number;
  y: number;
  scale: number;
  /** render order. undefined = auto by Y */
  depth?: number;
  /** optional tint (hex, e.g. 0x9CC8C2) */
  tint?: number;
  /** When true, the renderer plays `${textureKey}:${animation}`. */
  animated?: boolean;
  /** Animation name (must match a manifest AnimSpec.name). Defaults to "idle". */
  animation?: string;
}

export interface BuildingPosition {
  id: string;
  x: number;
  y: number;
}

export interface SpawnPoint {
  x: number;
  y: number;
}

export interface MapConfig {
  version: number;
  world: { width: number; height: number };
  baseTileset: string;
  terrain: Record<string, TerrainCell>;
  decorations: DecorationInstance[];
  buildings: BuildingPosition[];
  npcs: NpcPlacement[];
  spawn?: SpawnPoint;
  settings: MapSettings;
  meta: {
    createdAt: number;
    updatedAt: number;
    name: string;
  };
}

export interface TilesetManifest {
  key: string;
  label: string;
  path: string;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  rows: number;
}

/** Animation over a decoration spritesheet; indices are 0-based into its grid. */
export interface AnimSpec {
  name: string;
  start: number;
  end: number;
  frameRate?: number;   // default 10 at load time
  repeat?: number;      // default -1 (loop)
}

export interface DecorationManifest {
  key: string;
  label: string;
  path: string;
  category: 'tree' | 'bush' | 'rock' | 'stump' | 'cloud' | 'house' | 'prop' | 'water-rock' | 'water' | 'effect';
  group: string;
  /** Path from the theme root, e.g. ["Factions","Knights","Buildings","Castle"]. */
  folderPath?: string[];
  frameWidth?: number;
  frameHeight?: number;
  /** Derived from sheet dimensions / frame size. Only set for spritesheets. */
  frameCount?: number;
  /** Columns in the sheet (sheetWidth / frameWidth). */
  sheetColumns?: number;
  /** If present, Phaser animations named `${key}:${spec.name}` are registered at load. */
  animations?: AnimSpec[];
  defaultScale: number;
}

export interface ProtectedBuildingManifest {
  id: string;
  label: string;
  path: string;
  activity: string;
  defaultScale: number;
}

export interface AssetManifest {
  tilesets: TilesetManifest[];
  decorations: DecorationManifest[];
  protectedBuildings: ProtectedBuildingManifest[];
  npcSprites: NpcSpriteManifest[];
}
