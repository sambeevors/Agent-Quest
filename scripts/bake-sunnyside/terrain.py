"""Bake terrain sheets from the 16px Sunnyside tileset.

Outputs (all 64px tiles, x4 nearest-neighbour):
  terrain/grass.png  — frame 0 plain grass + decorated variants
  terrain/meadow.png — single 4x4-tile seamless mix for the base tileSprite
  terrain/road.png   — the 6-column road contract: cols 0-3 = 4x4 edge set
                       (rows: top edge / middle / bottom edge / both;
                        cols: left / middle / right / both), col 4 = gravel
                       accent, col 5 = grass tuft accent
  terrain/water.png  — frame 0 plain water + 3 ripple variants + sparkle
  terrain/shore.png  — the 8-frame shoreline contract read by
                       client/src/game/data/shore.ts: frames 0-3 = grass-fringe
                       decals for water to the N / E / S / W, frames 4-7 =
                       opaque diagonal corners with water to the NW / NE / SW / SE
  terrain/bridge.png — wooden jetty running N-S, mooring posts either side

The tileset has no orthogonal 16-tile dirt-path set, so the edge set is
synthesised: plain-earth fill + the artist's wavy grass border strips
((5,8) horizontal, (7,7) vertical), mirrored for the far sides.

The lake is drawn the way the pack draws water INSIDE a meadow — its ponds and
streams, not its ocean. The ocean block at (11..14, 18..21) is a deeper blue
made to meet cliffs and sand behind a foam rim; every inland pond in the
pack's example scene is the River autotile's cyan, edged by a dark-green grass
fringe. That autotile ((22..28, 7..8), "River" in the pack's GameMaker
tileset) is the only grass-to-water shoreline the pack ships, so the lake
takes its water as well as its shore from it.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

from common import TILE, Sources, crop_tiles, paste, save_png, upscale

# The pack draws its grass in two alternating base greens (a 16px checker in
# the source scenes). At the 64px world grid that checker reads as glitchy
# square patches wherever a decorated variant lands on a plain tile, so every
# baked grass tile is normalised to the plain green.
GRASS_BASE = (95, 193, 76)
GRASS_ALT = (99, 199, 77)


def normalise_grass(img):
    out = img.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a > 0 and (r, g, b) == GRASS_ALT:
                px[x, y] = (*GRASS_BASE, a)
    return out


def grass_decal(img):
    """Strip the grass background from a decorated tile, leaving the decal."""
    out = normalise_grass(img)
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a > 0 and (r, g, b) == GRASS_BASE:
                px[x, y] = (0, 0, 0, 0)
    return out

TILESET_PATH = "Tileset/spr_tileset_sunnysideworld_16px.png"

# Tile coordinates in the 16px sheet (tx, ty).
GRASS_PLAIN = (1, 1)
GRASS_VARIANTS = [(1, 2), (2, 2), (3, 2), (1, 4)]
GRASS_TUFT = (5, 2)  # sprig-heavy decorated grass, used as the road verge tuft
EARTH_FILL = (10, 7)
EARTH_GRAVEL = (9, 8)  # darker-blobbed earth, interior-road accent
BORDER_TOP = (5, 8)  # transparent overlay: wavy grass fringe along tile top
# Inland water: the River autotile's fill, plus its flowing-water frames, whose
# darker streaks become still-water ripples once laid on their side.
WATER_PLAIN = (22, 7)
WATER_RIPPLES = [(30, 8), (31, 8), (32, 8)]
WATER_SPARKLE = (11, 22)  # transparent white glint overlay
WATER_BASE = (50, 220, 232)
WATER_ACCENT = (34, 204, 219)

# River autotile shore pieces. Edge pieces are grass with the dark fringe drawn
# along the side that faces the water; diagonal pieces are half grass, half
# water, split corner to corner — the pack never draws a square pond corner.
SHORE_EDGES = {  # side the water lies on -> tile
    "n": (26, 8),
    "e": (27, 7),
    "s": (25, 7),
    "w": (24, 8),
}
SHORE_DIAGONALS = {  # corner the water fills -> tile
    "nw": (22, 8),
    "ne": (26, 7),
    "sw": (24, 7),
    "se": (23, 7),
}
# Frame order of terrain/shore.png — mirrored by SHORE_FRAME in shore.ts.
SHORE_ORDER = ["n", "e", "s", "w", "nw", "ne", "sw", "se"]

# Jetty modules: a one-tile-wide plank deck (two boards per tile) and the
# mooring posts that stand either side of it.
PIER_DECK = [(40, 5), (40, 6)]
PIER_POST_LEFT = (39, 5)  # post drawn against its tile's right edge
PIER_POST_RIGHT = (41, 5)  # post drawn against its tile's left edge
PIER_LENGTH = 3  # deck tiles, end to end


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
    # The tuft accent is drawn over whatever grass tile is underneath, so it
    # must be a transparent decal — an opaque grass square would stamp a
    # visibly different green onto decorated cells.
    tuft = grass_decal(crop_tiles(ts, *GRASS_TUFT))
    # The fringe strip is grass too, painted in both base greens like every
    # other grass tile — left alone it stamps alt-green specks along a verge.
    top = normalise_grass(crop_tiles(ts, *BORDER_TOP))

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
        paste(sheet, normalise_grass(crop_tiles(ts, tx, ty)), i * TILE, 0)
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
            paste(img, normalise_grass(crop_tiles(ts, tx, ty)), x * TILE, y * TILE)
    return img


def normalise_water(img):
    """Fold every opaque water tone that isn't the deliberate ripple accent into
    the one base cyan, so neighbouring tiles meet without a visible seam.

    The same job `normalise_grass` does for the meadow: the pack draws some
    water in two near-identical tones, and at the 64px world grid any second
    tone that isn't an intentional mark reads as a checker of tile squares.
    """
    out = img.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a != 255 or (r, g, b) in (WATER_BASE, WATER_ACCENT):
                continue
            if b > 200 and g > 140 and r < 80:  # a blue/cyan water tone
                px[x, y] = (*WATER_BASE, a)
    return out


def _ripples(tile: Image.Image) -> Image.Image:
    """Turn a flowing-water frame into a still-water one.

    The source streaks run vertically (a river's current) and carry on into the
    next frame down. Laid on their side they read as the short horizontal
    ripples of the pack's ponds. Any streak touching the tile border is
    dropped: the neighbouring cell won't continue it, and a dash cut off at a
    tile seam is exactly the patchwork this sheet exists to avoid.
    """
    t = tile.transpose(Image.TRANSPOSE)
    px = t.load()
    w, h = t.size
    seen: set[tuple[int, int]] = set()
    for y in range(h):
        for x in range(w):
            if (x, y) in seen or px[x, y][:3] != WATER_ACCENT:
                continue
            stack, run = [(x, y)], []
            seen.add((x, y))
            while stack:
                cx, cy = stack.pop()
                run.append((cx, cy))
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in seen and px[nx, ny][:3] == WATER_ACCENT:
                        seen.add((nx, ny))
                        stack.append((nx, ny))
            if any(cx in (0, w - 1) or cy in (0, h - 1) for cx, cy in run):
                for cx, cy in run:
                    px[cx, cy] = (*WATER_BASE, 255)
    return t


def build_water_sheet(ts: Image.Image) -> Image.Image:
    plain = normalise_water(crop_tiles(ts, *WATER_PLAIN))
    frames = [plain]
    for tx, ty in WATER_RIPPLES:
        frames.append(normalise_water(_ripples(crop_tiles(ts, tx, ty))))
    sparkle_tile = plain.copy()
    paste(sparkle_tile, crop_tiles(ts, *WATER_SPARKLE), 0, 0)
    frames.append(sparkle_tile)
    sheet = Image.new("RGBA", (TILE * len(frames), TILE))
    for i, f in enumerate(frames):
        paste(sheet, f, i * TILE, 0)
    return sheet


def build_shore_sheet(ts: Image.Image) -> Image.Image:
    """Frames in SHORE_ORDER.

    Edges are transparent decals — fringe only — so they lie over whichever
    grass variant the land cell already shows, and two of them compose on a
    cell with water on two sides. Diagonals are opaque: one of them replaces
    a whole cell, water half and grass half.
    """
    frames = [grass_decal(crop_tiles(ts, *SHORE_EDGES[side])) for side in SHORE_ORDER[:4]]
    for corner in SHORE_ORDER[4:]:
        frames.append(normalise_water(normalise_grass(crop_tiles(ts, *SHORE_DIAGONALS[corner]))))
    sheet = Image.new("RGBA", (TILE * len(frames), TILE))
    for i, f in enumerate(frames):
        paste(sheet, f, i * TILE, 0)
    return sheet


def build_bridge(ts: Image.Image) -> Image.Image:
    """A jetty running north-south, three tiles wide (post / deck / post).

    PIER_LENGTH deck tiles stack down the middle column, with a pair of
    mooring posts a plank-seam into the second tile and another at the far
    end. Its top tile is meant to rest on the bank, so the road arrives on
    timber rather than at the water's edge.
    """
    img = Image.new("RGBA", (TILE * 3, TILE * PIER_LENGTH))
    for i in range(PIER_LENGTH):
        paste(img, crop_tiles(ts, *PIER_DECK[i % len(PIER_DECK)]), TILE, i * TILE)
    for y in (TILE - 4, TILE * (PIER_LENGTH - 1)):
        paste(img, crop_tiles(ts, *PIER_POST_LEFT), 0, y)
        paste(img, crop_tiles(ts, *PIER_POST_RIGHT), TILE * 2, y)
    return img


def bake_terrain(src: Sources, out_dir: Path) -> dict:
    ts = _sheet(src)
    grass = build_grass_sheet(ts)
    save_png(upscale(grass), out_dir / "terrain" / "grass.png")
    save_png(upscale(build_meadow(ts)), out_dir / "terrain" / "meadow.png")
    save_png(upscale(build_road_sheet(ts)), out_dir / "terrain" / "road.png")
    water = build_water_sheet(ts)
    save_png(upscale(water), out_dir / "terrain" / "water.png")
    shore = build_shore_sheet(ts)
    save_png(upscale(shore), out_dir / "terrain" / "shore.png")
    save_png(upscale(build_bridge(ts)), out_dir / "terrain" / "bridge.png")
    return {
        "grassFrames": grass.width // TILE,
        "waterFrames": water.width // TILE,
        "shoreFrames": shore.width // TILE,
    }
