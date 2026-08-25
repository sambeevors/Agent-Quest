"""Bake terrain sheets from the 16px Sunnyside tileset.

Outputs (all 64px tiles, x4 nearest-neighbour):
  terrain/grass.png  — frame 0 plain grass + decorated variants
  terrain/meadow.png — single 4x4-tile seamless mix for the base tileSprite
  terrain/road.png   — the 6-column road contract: cols 0-3 = 4x4 edge set
                       (rows: top edge / middle / bottom edge / both;
                        cols: left / middle / right / both), col 4 = gravel
                       accent, col 5 = grass tuft accent
  terrain/water.png  — frame 0 plain water + wave variants + sparkle overlay
  terrain/bridge.png — wooden bridge deck (single image)

The tileset has no orthogonal 16-tile dirt-path set, so the edge set is
synthesised: plain-earth fill + the artist's wavy grass border strips
((5,8) horizontal, (7,7) vertical), mirrored for the far sides.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

from common import TILE, Sources, crop_tiles, paste, save_png, upscale

TILESET_PATH = "Tileset/spr_tileset_sunnysideworld_16px.png"

# Tile coordinates in the 16px sheet (tx, ty).
GRASS_PLAIN = (1, 1)
GRASS_VARIANTS = [(1, 2), (2, 2), (3, 2), (1, 4)]
GRASS_TUFT = (5, 2)  # sprig-heavy decorated grass, used as the road verge tuft
EARTH_FILL = (10, 7)
EARTH_GRAVEL = (9, 8)  # darker-blobbed earth, interior-road accent
BORDER_TOP = (5, 8)  # transparent overlay: wavy grass fringe along tile top
WATER_PLAIN = (11, 18)
WATER_VARIANTS = [(12, 18), (11, 19), (12, 19)]
WATER_SPARKLE = (11, 22)

# Wooden platform modules used for the bridge deck.
BRIDGE_RAIL = [(2, 9), (3, 9), (4, 9)]  # railing beam with posts
BRIDGE_PLANKS = [(10, 9), (10, 10), (10, 9)]  # plank fill


def _sheet(src: Sources) -> Image.Image:
    return src.image(TILESET_PATH)


def _strip_border(tile: Image.Image, side: str) -> Image.Image:
    """Orient the top-edge fringe overlay for any side.

    The tileset only ships a horizontal fringe; the vertical ones are the same
    strip transposed (exact pixel op, no resampling).
    """
    if side == "top":
        return tile
    if side == "bottom":
        return tile.transpose(Image.FLIP_TOP_BOTTOM)
    if side == "left":
        return tile.transpose(Image.TRANSPOSE)
    if side == "right":
        return tile.transpose(Image.TRANSPOSE).transpose(Image.FLIP_LEFT_RIGHT)
    raise ValueError(side)


def build_road_sheet(ts: Image.Image) -> Image.Image:
    fill = crop_tiles(ts, *EARTH_FILL)
    gravel = crop_tiles(ts, *EARTH_GRAVEL)
    tuft = crop_tiles(ts, *GRASS_TUFT)
    top = crop_tiles(ts, *BORDER_TOP)

    # edgeIndex order from path-tiles.ts: 0 = edge on the "before" side is
    # open (road continues) and "after" side closed... concretely:
    # row 0 -> top edge, row 1 -> no vertical edge, row 2 -> bottom edge,
    # row 3 -> both; col 0 -> left edge, col 1 -> none, col 2 -> right,
    # col 3 -> both.
    rows = [("top",), (), ("bottom",), ("top", "bottom")]
    cols = [("left",), (), ("right",), ("left", "right")]

    sheet = Image.new("RGBA", (TILE * 6, TILE * 4))
    for ry, vsides in enumerate(rows):
        for cx, hsides in enumerate(cols):
            t = fill.copy()
            for side in (*vsides, *hsides):
                paste(t, _strip_border(top, side), 0, 0)
            paste(sheet, t, cx * TILE, ry * TILE)
    paste(sheet, gravel, 4 * TILE, 0)
    paste(sheet, tuft, 5 * TILE, 0)
    return sheet


def build_grass_sheet(ts: Image.Image) -> Image.Image:
    frames = [GRASS_PLAIN, *GRASS_VARIANTS, GRASS_TUFT]
    sheet = Image.new("RGBA", (TILE * len(frames), TILE))
    for i, (tx, ty) in enumerate(frames):
        paste(sheet, crop_tiles(ts, tx, ty), i * TILE, 0)
    return sheet


def build_meadow(ts: Image.Image) -> Image.Image:
    """A 4x4 mostly-plain grass mix that tiles seamlessly for the base layer."""
    layout = [
        [GRASS_PLAIN, GRASS_PLAIN, GRASS_VARIANTS[0], GRASS_PLAIN],
        [GRASS_PLAIN, GRASS_VARIANTS[3], GRASS_PLAIN, GRASS_PLAIN],
        [GRASS_VARIANTS[1], GRASS_PLAIN, GRASS_PLAIN, GRASS_VARIANTS[2]],
        [GRASS_PLAIN, GRASS_PLAIN, GRASS_VARIANTS[0], GRASS_PLAIN],
    ]
    img = Image.new("RGBA", (TILE * 4, TILE * 4))
    for y, row in enumerate(layout):
        for x, (tx, ty) in enumerate(row):
            paste(img, crop_tiles(ts, tx, ty), x * TILE, y * TILE)
    return img


def build_water_sheet(ts: Image.Image) -> Image.Image:
    plain = crop_tiles(ts, *WATER_PLAIN)
    frames = [plain]
    for tx, ty in WATER_VARIANTS:
        frames.append(crop_tiles(ts, tx, ty))
    sparkle_tile = plain.copy()
    paste(sparkle_tile, crop_tiles(ts, *WATER_SPARKLE), 0, 0)
    frames.append(sparkle_tile)
    sheet = Image.new("RGBA", (TILE * len(frames), TILE))
    for i, f in enumerate(frames):
        paste(sheet, f, i * TILE, 0)
    return sheet


def build_bridge(ts: Image.Image) -> Image.Image:
    """3 tiles wide x 2 tall: railing beam over plank deck."""
    img = Image.new("RGBA", (TILE * 3, TILE * 2))
    for x, (tx, ty) in enumerate(BRIDGE_RAIL):
        paste(img, crop_tiles(ts, tx, ty), x * TILE, 0)
    for x, (tx, ty) in enumerate(BRIDGE_PLANKS):
        paste(img, crop_tiles(ts, tx, ty), x * TILE, TILE)
    return img


def bake_terrain(src: Sources, out_dir: Path) -> dict:
    ts = _sheet(src)
    grass = build_grass_sheet(ts)
    save_png(upscale(grass), out_dir / "terrain" / "grass.png")
    save_png(upscale(build_meadow(ts)), out_dir / "terrain" / "meadow.png")
    save_png(upscale(build_road_sheet(ts)), out_dir / "terrain" / "road.png")
    water = build_water_sheet(ts)
    save_png(upscale(water), out_dir / "terrain" / "water.png")
    save_png(upscale(build_bridge(ts)), out_dir / "terrain" / "bridge.png")
    return {
        "grassFrames": grass.width // TILE,
        "waterFrames": water.width // TILE,
    }
