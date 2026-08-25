import type * as Phaser from 'phaser';
import type { HeroPreview, HeroSpriteConfig, PreloadEntry, StaticAssetEntry, ThemeManifest, UnitColor, UnitType } from './types';

/**
 * Tiny Swords CC0 (Update 010) — bundled redistributable theme.
 *
 * The pack ships one combined PNG per (unit, color) at 192-px frames,
 * laid out as `rows = animation, columns = frame`:
 *   - Warrior (6×8): row 0 idle, row 1 walk, rows 2-4 attack, 5-7 variants
 *   - Pawn    (6×6): row 0 idle, row 1 walk, rows 2-3 work/attack, 4-5 variants
 *   - Archer  (8×7): row 0 idle (cols 0-5), row 1 idle variant, rows 2-6 shoot
 *
 * The archer has NO dedicated walk cycle in this pack — we reuse idle
 * frames for the run animation. Warriors and pawns use row 1 for walk.
 *
 * Fallbacks for missing (unit, color) combos:
 *   Monk  → Warrior (same color)
 *   Black → Purple  (same unit)
 * Combined: (monk, black) → (warrior, purple).
 *
 * Filename quirk: upstream pack ships `Archer/Purple/Archer_Purlple.png`
 * (author typo). Preserved verbatim so future pack updates diff cleanly.
 */

/**
 * Packed earth, derived from the pack's beach sand.
 *
 * Tiny Swords ships two ground surfaces — grass and sand — and roads want a
 * third. Sand alone reads as a beach: it is the brightest thing on the map and
 * pulls the eye off the village. Rather than invent a palette, the sand block
 * is recoloured onto the ramp the pack already uses for every wooden and
 * earthen thing in it — the bridge planks, the tree trunks — so the tracks look
 * like they were drawn by the same hand as everything they run past.
 *
 * Each entry maps one sand tone to its earth counterpart, brightest first. The
 * three anchors below are lifted verbatim from `Terrain/Bridge/Bridge_All.png`;
 * the rest sit on the line between them. The pack's universal outline
 * (#161C2E) is deliberately absent — it is left exactly as drawn.
 */
const SAND_TO_EARTH: ReadonlyArray<readonly [number, number]> = [
  [0xFEFA9D, 0xF0DCA8], // specular
  [0xF8F273, 0xE5C489], // highlight
  [0xF1DA84, 0xDAB570], // base            <- pack's earth highlight
  [0xDEC87E, 0xB48355], // mid             <- pack's earth base
  [0xB29678, 0x866353], // shadow          <- pack's earth shadow
  // The pebbles in the sand's scatter column, knocked back the same way.
  [0xB2AF5E, 0x8E6B4A],
  [0xAD9F6A, 0x9A7A54],
  [0xA09365, 0x7E5C46],
];

/** Where each piece lands in the generated sheet. Six columns, four rows. */
const ROAD_TILESET = {
  tilesetKey: 'terrain-road-cc0',
  columns: 6,
  blockFrame: 0,   // 4x4 edge block, columns 0-3
  gravelFrame: 4,  // recoloured pebbles
  tuftFrame: 5,    // grass tufts, copied across untouched
} as const;

/** Column in `Tilemap_Flat` where each source piece lives. */
const FLAT_SAND_COL = 5;
const FLAT_PEBBLE_COL = 9;
const FLAT_TUFT_COL = 4;

/**
 * Build the road tileset into a canvas texture and register its frames.
 *
 * Done at load time rather than shipped as a PNG so the recolour stays a
 * readable table next to the palette it came from, and so it cannot drift if
 * the upstream pack is updated.
 */
function buildRoadTileset(scene: Phaser.Scene, source: CanvasImageSource, tile: number): void {
  const { tilesetKey, columns } = ROAD_TILESET;
  if (scene.textures.exists(tilesetKey)) return;

  const canvas = document.createElement('canvas');
  canvas.width = columns * tile;
  canvas.height = 4 * tile;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;

  // The 4x4 sand block, then its pebbles — everything that gets recoloured.
  ctx.drawImage(source, FLAT_SAND_COL * tile, 0, 4 * tile, 4 * tile, 0, 0, 4 * tile, 4 * tile);
  ctx.drawImage(source, FLAT_PEBBLE_COL * tile, 0, tile, tile, 4 * tile, 0, tile, tile);

  const region = ctx.getImageData(0, 0, 5 * tile, 4 * tile);
  const px = region.data;
  const map = new Map(SAND_TO_EARTH);
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    const earth = map.get((px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!);
    if (earth === undefined) continue; // the outline, left as drawn
    px[i] = (earth >> 16) & 0xFF;
    px[i + 1] = (earth >> 8) & 0xFF;
    px[i + 2] = earth & 0xFF;
  }
  ctx.putImageData(region, 0, 0);

  // Grass tufts last, so the recolour doesn't turn the verge brown too.
  ctx.drawImage(source, FLAT_TUFT_COL * tile, 0, tile, tile, 5 * tile, 0, tile, tile);

  const texture = scene.textures.addCanvas(tilesetKey, canvas);
  if (texture === null) return;
  for (let frame = 0; frame < columns * 4; frame++) {
    texture.add(frame, 0, (frame % columns) * tile, Math.floor(frame / columns) * tile, tile, tile);
  }
}

/**
 * World scale for building art, against a doorway drawn at `REFERENCE_DOOR`.
 * Picked so the village keeps the footprint it has always had; at this value a
 * doorway comes out about 27px, a shade over a villager's height, so a hero
 * standing at one looks like it could walk through.
 */
const BUILDING_SCALE = 0.38;

// All CC0 units have dedicated sheets — no aliasing needed.
const resolveUnit = (unit: UnitType): UnitType => unit;

const resolveColor = (color: UnitColor): UnitColor =>
  color === 'black' ? 'purple' : color;

const GOBLIN_UNITS: readonly UnitType[] = ['tnt', 'torch'] as const;
const isGoblin = (u: UnitType): boolean => (GOBLIN_UNITS as readonly UnitType[]).includes(u);

/** Directory (and filename stem) for each goblin unit — note `TNT` is
 * all-caps in the upstream pack, so `cap()` can't derive it. */
const GOBLIN_DIR: Record<'tnt' | 'torch', string> = {
  tnt: 'TNT',
  torch: 'Torch',
};

/** Per-unit sheet shape and animation frame indices (0-based, row-major). */
type UnitSheetSpec = {
  sheetCols: number;
  sheetRows: number;
  idleFrames: number;
  runFrames: number;
  idleFrameIndices: number[];
  runFrameIndices: number[];
};

/** Per-unit sheet shape and animation frame indices.
 * Row counts verified against upstream PNG dimensions (frame = 192 px):
 *   warrior 1152×1536 → 6×8, pawn 1152×1152 → 6×6,
 *   archer 1536×1344 → 8×7, tnt 1344×576 → 7×3, torch 1344×960 → 7×5. */
const SHEET_SPEC: Record<UnitType, UnitSheetSpec> = {
  warrior: {
    sheetCols: 6,
    sheetRows: 8,
    idleFrames: 6,
    runFrames: 6,
    idleFrameIndices: [0, 1, 2, 3, 4, 5],
    runFrameIndices: [6, 7, 8, 9, 10, 11],
  },
  archer: {
    sheetCols: 8,
    sheetRows: 7,
    idleFrames: 6,
    // The CC0 archer sheet has row 0 and row 1 as idle variants (same
    // pose, subtle sway) and rows 2-4 as shoot animations with visible
    // arrows — using those for locomotion would make the archer fire
    // while walking. Row 1 at least has subtle frame variation; we reuse
    // it for run so the sprite moves without looking broken. If a later
    // pack revision ships a proper walk cycle, bump runFrameIndices.
    runFrames: 6,
    idleFrameIndices: [0, 1, 2, 3, 4, 5],
    runFrameIndices: [8, 9, 10, 11, 12, 13],
  },
  pawn: {
    sheetCols: 6,
    sheetRows: 6,
    idleFrames: 6,
    runFrames: 6,
    idleFrameIndices: [0, 1, 2, 3, 4, 5],
    runFrameIndices: [6, 7, 8, 9, 10, 11],
  },
  // Goblins — combined sheets at 192px. tnt and torch sheets are 7 cols
  // × N rows, but per Tiny Swords convention only the first 6 cols of
  // each row are populated (col 6 is padding). Using 7 frames would
  // leave a blank frame per cycle → visible flicker. Use 6.
  tnt: {
    sheetCols: 7,
    sheetRows: 3,
    idleFrames: 6,
    runFrames: 6,
    idleFrameIndices: [0, 1, 2, 3, 4, 5],
    runFrameIndices: [7, 8, 9, 10, 11, 12],
  },
  torch: {
    sheetCols: 7,
    sheetRows: 5,
    idleFrames: 6,
    runFrames: 6,
    idleFrameIndices: [0, 1, 2, 3, 4, 5],
    runFrameIndices: [7, 8, 9, 10, 11, 12],
  },
};

const COLORS: UnitColor[] = ['blue', 'yellow', 'red', 'black', 'purple'];
const UNITS: UnitType[] = ['warrior', 'archer', 'pawn', 'tnt', 'torch'];

const cap = (s: string): string => s[0]!.toUpperCase() + s.slice(1);

function filePath(color: UnitColor, unit: UnitType): string {
  const ru = resolveUnit(unit);
  const rc = resolveColor(color);
  if (isGoblin(ru)) {
    // Goblins live under Factions/Goblins/Troops — no typo quirks. `TNT`
    // is all-caps in the pack (both directory and filename), so we look
    // the directory name up in GOBLIN_DIR rather than derive via cap().
    const unitDir = GOBLIN_DIR[ru as 'tnt' | 'torch'];
    const colorDir = cap(rc);
    return `assets/themes/tiny-swords-cc0/Factions/Goblins/Troops/${unitDir}/${colorDir}/${unitDir}_${colorDir}.png`;
  }
  const unitCap = cap(ru);
  const colorDirCap = cap(rc);
  // Upstream typo: Archer_Purlple.png (not "Purple"). The *directory* name
  // is still "Purple" though — only the file's suffix is misspelled.
  const fileColorCap = ru === 'archer' && rc === 'purple' ? 'Purlple' : colorDirCap;
  return `assets/themes/tiny-swords-cc0/Factions/Knights/Troops/${unitCap}/${colorDirCap}/${unitCap}_${fileColorCap}.png`;
}

const idleKey = (color: UnitColor, unit: UnitType): string =>
  `cc0-${resolveColor(color)}-${resolveUnit(unit)}-idle`;
const runKey = (color: UnitColor, unit: UnitType): string =>
  `cc0-${resolveColor(color)}-${resolveUnit(unit)}-run`;

export const tinySwordsCc0Theme: ThemeManifest = {
  id: 'tiny-swords-cc0',
  name: 'Tiny Swords (CC0)',
  // Same frame size as the default theme (192 px) → same scale.
  heroScale: 0.55,
  buildingScale: BUILDING_SCALE,

  getHeroPreload(): PreloadEntry[] {
    const entries: PreloadEntry[] = [];
    // De-dupe on RESOLVED (color, unit) so fallbacks don't re-register the
    // same texture twice. Each unique sheet still registers under both an
    // idle and a run key because HeroSprite builds anim keys as
    // `${textureKey}-anim` and needs them distinct.
    const seen = new Set<string>();
    for (const color of COLORS) {
      for (const unit of UNITS) {
        const dedupe = `${resolveColor(color)}-${resolveUnit(unit)}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        const path = filePath(color, unit);
        entries.push({ key: idleKey(color, unit), path, frameWidth: 192, frameHeight: 192 });
        entries.push({ key: runKey(color, unit),  path, frameWidth: 192, frameHeight: 192 });
      }
    }
    return entries;
  },

  getHeroConfig(color: UnitColor, unit: UnitType): HeroSpriteConfig {
    const spec = SHEET_SPEC[resolveUnit(unit)];
    return {
      idleKey: idleKey(color, unit),
      runKey: runKey(color, unit),
      idleFrames: spec.idleFrames,
      runFrames: spec.runFrames,
      idleFrameIndices: spec.idleFrameIndices,
      runFrameIndices: spec.runFrameIndices,
      facesLeft: false,
      tint: null,
    };
  },

  getHeroPreview(color: UnitColor, unit: UnitType): HeroPreview {
    const spec = SHEET_SPEC[resolveUnit(unit)];
    return {
      url: `/${filePath(color, unit)}`,
      sheetColumns: spec.sheetCols,
      sheetRows: spec.sheetRows,
      frameWidth: 192,
      frameHeight: 192,
    };
  },

  terrain: {
    tilesetKey: 'terrain-tileset-cc0',
    path: 'assets/themes/tiny-swords-cc0/Terrain/Ground/Tilemap_Flat.png',
    tileSize: 64,
    // 10×4 grid holding two surfaces, each a 4×4 block of edge tiles: grass at
    // columns 0-3, beach sand at columns 5-8. Column 4 is loose grass tufts and
    // column 9 loose pebbles — the artist's own scatter for each surface.
    grassFrame: 0,
    road: ROAD_TILESET,
  },

  getBuildingImage(id: string): string {
    return CC0_BUILDINGS[id] ?? `assets/buildings/${id}.png`;
  },

  getBuildingScale(id: string): number {
    const door = DOOR_HEIGHT[id];
    return door === undefined
      ? BUILDING_SCALE
      : BUILDING_SCALE * (REFERENCE_DOOR / door);
  },

  getStaticAssetPreload(): StaticAssetEntry[] {
    const entries: StaticAssetEntry[] = [];
    const DECO = 'assets/themes/tiny-swords-cc0/Deco';
    const RES_TREES = 'assets/themes/tiny-swords-cc0/Resources/Trees';
    const KNIGHTS_BUILD = 'assets/themes/tiny-swords-cc0/Factions/Knights/Buildings';

    // Ground props, keyed by what the sprite ACTUALLY depicts. The upstream
    // pack numbers Deco/01-18 without naming them, and the previous mapping had
    // them crossed over — mushrooms registered as `bush-*`, bushes as `rock-*`,
    // rocks as `stump-*` — so scattering "rocks" put shrubs on the map.
    // Verified against the art: 01-03 mushrooms, 04-08 rocks, 09-11 shrubs.
    // (12-13 are gourds, 14 a bone, 15-17 signposts/pillars at 64×128, 18 is
    // 192×192 — none of them scatter well, so they're left out.)
    const MUSHROOM_DECO = [1, 2, 3];
    const ROCK_DECO = [4, 5, 6, 7, 8];
    const BUSH_DECO = [9, 10, 11];
    const deco = (n: number): string => `${DECO}/${String(n).padStart(2, '0')}.png`;
    MUSHROOM_DECO.forEach((n, i) => entries.push({ key: `mushroom-${i + 1}`, path: deco(n) }));
    ROCK_DECO.forEach((n, i) => entries.push({ key: `rock-${i + 1}`, path: deco(n) }));
    BUSH_DECO.forEach((n, i) => entries.push({ key: `bush-${i + 1}`, path: deco(n) }));

    // Trees: Tree.png is a 768×576 atlas (4×3 grid of 192-px frames).
    // Load the whole atlas once; postLoadHook slices frames 0-3 into
    // tree-1..4 textures so existing TerrainRenderer callsites keep
    // working unchanged.
    entries.push({
      key: 'cc0-trees-atlas',
      path: `${RES_TREES}/Tree.png`,
      frameWidth: 192,
      frameHeight: 192,
    });

    // Decorative coloured houses — 5 colours × 4 kinds. CC0 has 4 colours;
    // black falls back to purple. Four "kinds" map to House / House
    // Construction / House Destroyed / Tower of the same colour.
    const colorToCc0: Record<string, UnitColor> = {
      blue: 'blue', yellow: 'yellow', red: 'red', purple: 'purple', black: 'purple',
    };
    for (const logical of ['blue', 'yellow', 'red', 'purple', 'black'] as const) {
      const cc0Color = colorToCc0[logical]!;
      const Cc0 = cap(cc0Color);
      entries.push({ key: `house-${logical}-house1`, path: `${KNIGHTS_BUILD}/House/House_${Cc0}.png` });
      entries.push({ key: `house-${logical}-house2`, path: `${KNIGHTS_BUILD}/House/House_Construction.png` });
      entries.push({ key: `house-${logical}-house3`, path: `${KNIGHTS_BUILD}/House/House_Destroyed.png` });
      entries.push({ key: `house-${logical}-tower`,  path: `${KNIGHTS_BUILD}/Tower/Tower_${Cc0}.png` });
    }

    return entries;
  },

  postLoadHook(scene: Phaser.Scene): void {
    // Derive the packed-earth road tiles from the ground tileset.
    if (scene.textures.exists('terrain-tileset-cc0')) {
      buildRoadTileset(
        scene,
        scene.textures.get('terrain-tileset-cc0').getSourceImage() as CanvasImageSource,
        64,
      );
    }

    // Slice the tree atlas into 4 separate textures named tree-1..4 so
    // TerrainRenderer.drawForestTrees can pick them at random without
    // knowing we sourced them from a single sheet.
    if (!scene.textures.exists('cc0-trees-atlas')) return;
    const source = scene.textures.get('cc0-trees-atlas').getSourceImage() as HTMLImageElement | HTMLCanvasElement;
    for (let i = 1; i <= 4; i++) {
      const key = `tree-${i}`;
      if (scene.textures.exists(key)) continue;
      const canvas = document.createElement('canvas');
      canvas.width = 192;
      canvas.height = 192;
      const ctx = canvas.getContext('2d');
      if (ctx === null) continue;
      // Draw frame (i-1) of the atlas — row 0, column (i-1).
      ctx.drawImage(source, -(i - 1) * 192, 0);
      scene.textures.addCanvas(key, canvas);
    }
  },
};

/**
 * Building artwork.
 *
 * These eight PNGs were drawn for this project rather than taken from the
 * pack, and they are NOT all drawn at the same zoom. Measured on the doorways,
 * the one human-scale feature every building has:
 *
 *   library 68 · tavern 70 · chapel 70 · watchtower 78   <- agree
 *   castle 60 · arena 90 · forge 115 · alchemist 140      <- do not
 *
 * The Alchemist is drawn at roughly twice the Castle's scale. Rendering every
 * file at one scale — the obvious reading of "respect the asset's size" —
 * faithfully reproduces that, which is why it put enormous huts next to a
 * miniature castle.
 *
 * `DOOR_HEIGHT` records those measurements and each building is scaled by how
 * far its doorway sits from the reference. That is still a single world scale;
 * the per-building numbers correct the source art rather than overrule it, so
 * a doorway ends up the same size on every building and the castle is the
 * widest thing in the village again. Redrawing the art at a consistent zoom
 * would remove the need for the table.
 */
const CUSTOM_BUILDINGS_BASE = 'assets/themes/tiny-swords-cc0/BuildingsCustom';

/**
 * Doorway height in each PNG, in that PNG's own pixels, read off the artwork to
 * within a few px. A door is about two metres in any world, so this is what
 * says how zoomed-in a drawing is — and these vary only because the drawings
 * disagree with each other.
 */
export const DOOR_HEIGHT: Record<string, number> = {
  library: 68,
  tavern: 70,
  chapel: 70,
  watchtower: 78,
  castle: 60,
  arena: 90,
  forge: 115,
  alchemist: 140,
};

/** The zoom most of the set already agrees on, so most buildings barely move. */
const REFERENCE_DOOR = 70;

const CC0_BUILDINGS: Record<string, string> = {
  castle:     `${CUSTOM_BUILDINGS_BASE}/Castle.png`,
  library:    `${CUSTOM_BUILDINGS_BASE}/Library.png`,
  forge:      `${CUSTOM_BUILDINGS_BASE}/Forge.png`,
  tavern:     `${CUSTOM_BUILDINGS_BASE}/Tavern.png`,
  chapel:     `${CUSTOM_BUILDINGS_BASE}/Chapel.png`,
  watchtower: `${CUSTOM_BUILDINGS_BASE}/Tower.png`,
  arena:      `${CUSTOM_BUILDINGS_BASE}/Arena.png`,
  alchemist:  `${CUSTOM_BUILDINGS_BASE}/Alchemist.png`,
};
