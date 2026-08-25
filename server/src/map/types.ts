/**
 * The village's data model — server and client share the same shape.
 * If you change this file, mirror the change in
 * client/src/game/data/map-config.ts.
 */

export interface MapSettings {
  heroScale: number;
  /** Asset theme the map was authored against. Optional — absent value
   * falls back to the default theme. */
  theme?: string;
}

/** Reference to a tile inside a loaded tileset spritesheet. */
export interface TileRef {
  /** tileset key, e.g. "terrain-color1" */
  set: string;
  /** frame index inside the spritesheet (0-based row-major) */
  frame: number;
}

/** A single painted terrain cell, keyed by `${col},${row}` in MapConfig.terrain. */
export interface TerrainCell {
  tile: TileRef;
  /** true if characters can walk on this tile (grass, dirt, path) */
  walkable: boolean;
}

/** Free-placed decoration sprite (water, water rocks, the bridge). */
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
  /** When true, renderer calls sprite.play(`${textureKey}:${animation}`). Optional for back-compat. */
  animated?: boolean;
  /** Animation name (must match one of the manifest's AnimSpec.name). Defaults to "idle". */
  animation?: string;
}

/** One of the eight interactive activity buildings. */
export interface BuildingPosition {
  id: string;
  x: number;
  y: number;
}

/** World-space spawn point where new heroes appear before walking into the village. */
export interface SpawnPoint {
  x: number;
  y: number;
}

export interface MapConfig {
  version: number;
  world: { width: number; height: number };
  /** base terrain colour variant (which Tilemap_colorN.png fills the ground when no cell paints over it) */
  baseTileset: string;
  /** sparse grid — only cells painted explicitly. Key: `${col},${row}` */
  terrain: Record<string, TerrainCell>;
  decorations: DecorationInstance[];
  buildings: BuildingPosition[];
  /** Optional hero spawn point. Falls back to VILLAGE_GATE when absent. */
  spawn?: SpawnPoint;
  /** map-level settings */
  settings: MapSettings;
  meta: {
    createdAt: number;
    updatedAt: number;
    name: string;
  };
}

// ---------------------------------------------------------------------------
// Asset manifest — served by GET /api/assets/manifest
// ---------------------------------------------------------------------------

export interface TilesetManifest {
  key: string;
  label: string;
  path: string;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  rows: number;
}

/** Animation definition for a decoration spritesheet. frame indices are
 * 0-based into the sheet's frame grid. */
export interface AnimSpec {
  name: string;         // "idle" | "walk" | "attack" | ...
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
  /** Group label — typically `folderPath.join('/')`. */
  group: string;
  /** Hierarchical path from the theme root, e.g. ["Factions","Knights","Buildings","Castle"].
   * Optional — entries without a folder path render under the tree root as a flat group. */
  folderPath?: string[];
  frameWidth?: number;
  frameHeight?: number;
  /** Derived from sheet dimensions / frame size. Only set for spritesheets. */
  frameCount?: number;
  /** Columns in the sheet (sheetWidth / frameWidth) — lets a consumer read
   * multi-row atlases like Tree (4×3) without assuming a single row. */
  sheetColumns?: number;
  /** If present, Phaser animations named `${key}:${spec.name}` are registered at load time. */
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
}
