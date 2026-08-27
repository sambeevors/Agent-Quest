"""Assemble the 8 activity buildings (plus construction-site sprites) from the
Sunnyside modular buildings sheet, the 16px tileset, and the GameMaker deco
sprites.

Every building is composed on a 16px-native canvas and upscaled x4, so all
doorways land at one consistent zoom by construction. Roofs are recoloured
from the buildings sheet's blue shingle ramp to per-building ramps sampled
from the tileset's coloured roof blocks; window glass is tinted to match
(the tileset's own colour blocks tint their glass the same way).

Two of the eight are ENCLOSURES rather than halls — the arena (a fenced
sparring yard) and the farm (fenced crop rows). They bake as a fence-ring
structure plus a separate `-ground` floor image, and declare the interior
region where the client stations heroes; see the enclosure recipes below.
"""

from __future__ import annotations

import io
from pathlib import Path

from PIL import Image, ImageDraw

from common import GAMEMAKER, SCALE, TILE, Sources, crop_tiles, paste, save_png, upscale
from terrain import BORDER_TOP, EARTH_FILL, _strip_border

# Hand-drawn, non-pack-derived sprites that recipes paste through unchanged.
ART = Path(__file__).resolve().parent / "art"

# Bounding boxes in SUNNYSIDE_WORLD_BUILDINGS_V0.01.png (x0, y0, x1, y1
# inclusive), catalogued by eye from the sheet. Only the pieces the surviving
# assembled recipes still need — the six halls are hand-drawn now, and their
# house/storey/tower/shutter/vent entries went with them (see git history if
# you ever need those coordinates back).
PIECES = {
    "house_small": (13, 129, 66, 172),  # 54x44 gable house with arch door
    "ladder": (272, 73, 287, 98),  # 16x26 orange-rung ladder
    "bracket": (273, 32, 286, 40),
}

# Doorway holes are transparent in the sheet; each recipe backs them with this.
DOOR_DARK = (32, 28, 44, 255)

# Wooden fence autotile pieces in the 16px tileset, keyed by the sides each
# piece connects to (N/E/S/W). Horizontal runs are post-and-rail; vertical
# runs are a post with a thin pale rail — the pack's own farm scenes ring
# their paddocks with exactly these tiles.
#
# EVERY piece here must come from the one autotile set laid out as a cross at
# (38..42, 1..4). The tileset also carries a shorter free-standing rail pair at
# (38..39, 0) whose rail sits two pixels higher in the tile; borrowing the
# straight run from there is what left the corners of the arena and farm not
# meeting their rails.
FENCE = {
    "h_end_w": (38, 2),  # connects E — west end of a horizontal run
    "h_mid": (39, 2),  # E+W
    "h_end_e": (42, 2),  # W — east end
    "v_end_n": (40, 1),  # S — north end of a vertical run
    "v_mid": (40, 3),  # N+S
    "v_end_s": (40, 4),  # N — south end
    "nw": (42, 1),  # E+S
    "ne": (41, 1),  # W+S
    "sw": (39, 1),  # N+E
    "se": (38, 1),  # N+W
    "post": (41, 3),  # lone post
}

# The buildings sheet's shingle ramp (dark, mid, light) and glass cyans.
ROOF_SOURCE = [(18, 78, 137), (30, 109, 213), (0, 153, 219)]
GLASS_SOURCE = [(5, 191, 242), (0, 214, 244), (44, 232, 245), (166, 249, 255)]
GLASS_WHITE_MIX = [0.30, 0.40, 0.50, 0.78]

# Target ramps in the tileset's roof-block style (dark, mid, light).
ROOF_RAMPS: dict[str, list[tuple[int, int, int]]] = {
    "blue": ROOF_SOURCE,
    "red": [(164, 38, 51), (226, 58, 67), (235, 100, 107)],
    "green": [(38, 85, 50), (97, 144, 75), (144, 191, 93)],
    "purple": [(115, 53, 102), (158, 71, 126), (183, 107, 170)],
    "orange": [(150, 60, 24), (214, 106, 44), (238, 148, 74)],
    "yellow": [(178, 122, 22), (232, 176, 48), (250, 214, 96)],
}


def _mix(c: tuple[int, int, int], k: float) -> tuple[int, int, int]:
    return tuple(round(v + (255 - v) * k) for v in c)  # type: ignore[return-value]


def _roof_mapping(color: str) -> dict[tuple[int, int, int], tuple[int, int, int]]:
    ramp = ROOF_RAMPS[color]
    mapping = {src: dst for src, dst in zip(ROOF_SOURCE, ramp)}
    for src, k in zip(GLASS_SOURCE, GLASS_WHITE_MIX):
        mapping[src] = _mix(ramp[2], k)
    return mapping


def recolor_roof(img: Image.Image, color: str) -> Image.Image:
    if color == "blue":
        return img
    mapping = _roof_mapping(color)
    sources = list(mapping)
    out = img.copy()
    px = out.load()
    tol = 2
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            for sr, sg, sb in sources:
                if abs(r - sr) <= tol and abs(g - sg) <= tol and abs(b - sb) <= tol:
                    tr, tg, tb = mapping[(sr, sg, sb)]
                    px[x, y] = (tr, tg, tb, a)
                    break
    return out


class Kit:
    def __init__(self, src: Sources):
        self.sheet = src.buildings_sheet()
        self.tileset = src.image("Tileset/spr_tileset_sunnysideworld_16px.png")
        self.src = src

    def piece(self, name: str, roof: str = "blue") -> Image.Image:
        x0, y0, x1, y1 = PIECES[name]
        return recolor_roof(self.sheet.crop((x0, y0, x1 + 1, y1 + 1)), roof)

    def tiles(self, tx: int, ty: int, tw: int = 1, th: int = 1) -> Image.Image:
        return crop_tiles(self.tileset, tx, ty, tw, th)

    def gm(self, sprite: str, frame: int = 0) -> Image.Image:
        """A GameMaker deco sprite frame (frames are uuid-named PNGs)."""
        prefix = GAMEMAKER + f"sprites/{sprite}/"
        names = sorted(
            n
            for n in self.src.pack.namelist()
            if n.startswith(prefix) and n.lower().endswith(".png") and "__MACOSX" not in n
        )
        if not names:
            raise KeyError(f"gamemaker sprite not found: {sprite}")
        return Image.open(
            io.BytesIO(self.src.pack.read(names[min(frame, len(names) - 1)]))
        ).convert("RGBA")


def canvas(w: int, h: int) -> Image.Image:
    return Image.new("RGBA", (w, h))


def dark_rect(img: Image.Image, x0: int, y0: int, x1: int, y1: int) -> None:
    ImageDraw.Draw(img).rectangle([x0, y0, x1, y1], fill=DOOR_DARK)


# Hand-drawn buildings. The pack ships no prefab buildings, and the modular
# sheet's house/storey parts only ever composed into rows of huts wearing hats
# — so these are drawn instead, on the same 16px grid every recipe here uses.
# The bake still owns the x4 upscale and the metadata, so nothing downstream
# can tell an assembled recipe from a drawn one. See art/README.md.


def drawn(name: str, door_h: int, chimney: tuple[int, int]):
    def recipe(kit: Kit):
        del kit  # drawn art, not assembled from the pack
        return Image.open(ART / f"{name}.png").convert("RGBA"), door_h, chimney

    return recipe


# Each recipe returns (image16px, door_height_16px, chimney_anchor_16px).
# door_height: doorway height in the composed 16px image (x4 when baked);
# chimney anchor: (x, y) where smoke should originate, in 16px canvas coords.


def _fence_ring(kit: Kit, cols: int, rows: int, gate_cols: set[int]) -> Image.Image:
    """Fence ring on a cols x rows tile canvas, with a gate gap in the bottom
    row at gate_cols. The rail stops on capped end pieces either side of the
    gap, so the opening reads as a gateway rather than a broken fence."""
    img = canvas(cols * TILE, rows * TILE)

    def t(name: str) -> Image.Image:
        return kit.tiles(*FENCE[name])

    paste(img, t("nw"), 0, 0)
    for c in range(1, cols - 1):
        paste(img, t("h_mid"), c * TILE, 0)
    paste(img, t("ne"), (cols - 1) * TILE, 0)
    for r in range(1, rows - 1):
        paste(img, t("v_mid"), 0, r * TILE)
        paste(img, t("v_mid"), (cols - 1) * TILE, r * TILE)
    br = (rows - 1) * TILE
    paste(img, t("sw"), 0, br)
    for c in range(1, cols - 1):
        if c in gate_cols:
            continue
        if c == min(gate_cols) - 1:
            paste(img, t("h_end_e"), c * TILE, br)
        elif c == max(gate_cols) + 1:
            paste(img, t("h_end_w"), c * TILE, br)
        else:
            paste(img, t("h_mid"), c * TILE, br)
    paste(img, t("se"), (cols - 1) * TILE, br)
    return img


def _earth_rect(kit: Kit, tw: int, th: int) -> Image.Image:
    """Packed-earth floor with the artist's wavy grass fringe on every edge —
    the same synthesis the road bake uses, so an enclosure floor meets the
    meadow the way a road does."""
    fill = kit.tiles(*EARTH_FILL)
    top = kit.tiles(*BORDER_TOP)
    img = canvas(tw * TILE, th * TILE)
    for r in range(th):
        for c in range(tw):
            t = fill.copy()
            if r == 0:
                paste(t, _strip_border(top, "top"), 0, 0)
            if r == th - 1:
                paste(t, _strip_border(top, "bottom"), 0, 0)
            if c == 0:
                paste(t, _strip_border(top, "left"), 0, 0)
            if c == tw - 1:
                paste(t, _strip_border(top, "right"), 0, 0)
            paste(img, t, c * TILE, r * TILE)
    return img


# Enclosure recipes return (structure, ground, door_height_16px, interior).
# The GROUND image is drawn beneath the y-sorted world (heroes walk over it);
# the STRUCTURE image keeps the fence and props at normal building depth, so
# a hero inside shows through the transparent middle and the front rail still
# overlaps their feet on the way in. `interior` is the (x, y, w, h) region of
# the canvas, in 16px coords, where stationed heroes may stand.


def build_arena(kit: Kit):
    # Fenced sparring yard: packed-earth floor, sword stores just inside the
    # rail. The goblin and skeleton the heroes spar with are live sprites
    # placed by the scene (ArenaFighters), not baked pixels.
    cols, rows = 8, 5  # 128x80
    img = _fence_ring(kit, cols, rows, gate_cols={3, 4})
    swords = kit.gm("spr_deco_barrel_swords")
    paste(img, swords, 8, 32 - swords.height)
    sword = kit.gm("spr_deco_sword_floor")
    paste(img, sword, 98, 24)

    # Earth over the whole footprint, fence included — a yard's fence stands
    # ON the packed ground, and stopping the dirt inside the rail left a ring
    # of lawn between the floor and the posts.
    ground = canvas(cols * TILE, rows * TILE)
    paste(ground, _earth_rect(kit, cols, rows), 0, 0)
    return img, ground, 18, (16, 22, 96, 38)


# The farm's tilled beds, in the ground layer's own 16px coords: three rows of
# five, sunflowers at the back, then pumpkins, then cauliflowers, with walking
# gaps between the rows. build_farm paints from these and the bake exports the
# bed CENTRES, so the scene can send a farmer to stand on a crop and water it
# rather than anywhere inside the fence.
FARM_CROP_ROWS = ("sunflower_04", "pumpkin_04", "cauliflower_04")
FARM_CROP_COLS = 5
FARM_BED_ORIGIN = (16, 20)  # top-left of the back row's first bed
FARM_BED_PITCH = (19, 22)  # bed spacing, x then y
FARM_BED_SIZE = (16, 12)  # Elements/Crops/soil_01.png


def farm_bed_centres() -> list[tuple[int, int]]:
    """Centre of every tilled bed, row by row, in the farm image's 16px coords."""
    ox, oy = FARM_BED_ORIGIN
    px, py = FARM_BED_PITCH
    bw, bh = FARM_BED_SIZE
    return [
        (ox + col * px + bw // 2, oy + row * py + bh // 2)
        for row in range(len(FARM_CROP_ROWS))
        for col in range(FARM_CROP_COLS)
    ]


def build_farm(kit: Kit):
    # Fenced smallholding: three tilled rows (sunflowers at the back, then
    # pumpkins, then cauliflowers) with walking gaps between them. Heroes come
    # in through the gate and work the land (watering animation).
    #
    # The water barrel and bucket stand OUTSIDE, on the grass beside the gate:
    # inside the yard they overlapped the back crop row, and a prop that
    # crosses a plant reads as breakage rather than clutter.
    cols, rows = 8, 6  # fence ring, 128x96
    prop_rows = 1  # grass verge below the gate for the watering kit
    img = canvas(cols * TILE, (rows + prop_rows) * TILE)
    paste(img, _fence_ring(kit, cols, rows, gate_cols={3, 4}), 0, 0)
    verge = (rows + prop_rows) * TILE
    barrel = kit.gm("spr_deco_barrel_water")
    paste(img, barrel, 20, verge - barrel.height)
    bucket = kit.gm("spr_deco_bucket")
    paste(img, bucket, 37, verge - bucket.height)

    # Earth over the whole yard, fence included (see build_arena) — a
    # smallholding is worked soil, not lawn with stripes of crop in it. The
    # verge below the gate stays grass, so the fence still reads as a boundary.
    ground = canvas(img.width, img.height)
    paste(ground, _earth_rect(kit, cols, rows), 0, 0)
    soil = kit.src.image("Elements/Crops/soil_01.png")  # 16x12
    for row, crop_name in enumerate(FARM_CROP_ROWS):
        plant = kit.src.image(f"Elements/Crops/{crop_name}.png")
        y = FARM_BED_ORIGIN[1] + row * FARM_BED_PITCH[1]
        for col in range(FARM_CROP_COLS):
            x = FARM_BED_ORIGIN[0] + col * FARM_BED_PITCH[0]
            paste(ground, soil, x, y)
            paste(ground, plant, x + (soil.width - plant.width) // 2, y + soil.height - plant.height - 1)
    return img, ground, 18, (14, 20, 100, 56)


BUILDING_RECIPES = {
    "library": drawn("library", 16, (54, 0)),
    "forge": drawn("forge", 13, (36, 1)),
    "tavern": drawn("tavern", 13, (36, 2)),
    "alchemist": drawn("alchemist", 12, (22, 1)),
    "castle": drawn("castle", 13, (46, 24)),
    "watchtower": drawn("watchtower", 12, (18, 2)),
}

# Enclosures the heroes physically enter: the arena (bash — sparring against
# goblin and skeleton NPCs) and the farm (git — working the land).
ENCLOSURE_RECIPES = {
    "arena": build_arena,
    "farm": build_farm,
}

SITE_COLORS = ["blue", "yellow", "red", "purple"]


def build_site_house(kit: Kit, color: str) -> Image.Image:
    img = canvas(56, 46)
    dark_rect(img, 1 + 19, 2 + 31, 1 + 34, 2 + 43)
    paste(img, kit.piece("house_small", color), 1, 2)
    return img


def build_scaffold(kit: Kit) -> Image.Image:
    img = canvas(56, 46)
    crate1 = kit.gm("spr_deco_crate_01")
    crate2 = kit.gm("spr_deco_crate_02")
    paste(img, crate1, 4, 46 - crate1.height)
    paste(img, crate2, 18, 46 - crate2.height)
    paste(img, crate2, 10, 46 - crate2.height - 10)
    wood = kit.src.image("Elements/Crops/wood.png")
    paste(img, wood, 36, 46 - wood.height)
    ladder = kit.piece("ladder")
    paste(img, ladder, 38, 46 - 12 - ladder.height)
    beam = kit.piece("bracket")
    paste(img, beam, 22, 40)
    return img


def bake_buildings(src: Sources, out_dir: Path) -> dict:
    kit = Kit(src)
    meta: dict = {"doorHeight": {}, "size": {}, "chimney": {}, "interior": {}, "crops": {}}
    for name, recipe in BUILDING_RECIPES.items():
        img, door_h, chimney = recipe(kit)
        baked = upscale(img)
        save_png(baked, out_dir / "buildings" / f"{name}.png")
        meta["doorHeight"][name] = door_h * SCALE
        meta["size"][name] = [baked.width, baked.height]
        meta["chimney"][name] = [chimney[0] * SCALE, chimney[1] * SCALE]
    # Enclosures: structure at building depth + ground layer underneath.
    # No chimney (nothing to smoke); `interior` is where heroes may stand.
    for name, recipe in ENCLOSURE_RECIPES.items():
        img, ground, door_h, interior = recipe(kit)
        baked = upscale(img)
        save_png(baked, out_dir / "buildings" / f"{name}.png")
        save_png(upscale(ground), out_dir / "buildings" / f"{name}-ground.png")
        meta["doorHeight"][name] = door_h * SCALE
        meta["size"][name] = [baked.width, baked.height]
        meta["interior"][name] = [v * SCALE for v in interior]
    # Where the farm's crops stand, for heroes to work row by row. Baked from
    # the same constants that paint the beds, so a recipe change moves both.
    meta["crops"]["farm"] = [[x * SCALE, y * SCALE] for x, y in farm_bed_centres()]
    for color in SITE_COLORS:
        save_png(upscale(build_site_house(kit, color)), out_dir / "buildings" / f"house-{color}.png")
    save_png(upscale(build_scaffold(kit)), out_dir / "buildings" / "site-scaffold.png")
    return meta
