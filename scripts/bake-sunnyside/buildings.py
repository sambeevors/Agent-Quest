"""Assemble the 8 activity buildings (plus construction-site sprites) from the
Sunnyside modular buildings sheet, the 16px tileset, and the GameMaker deco
sprites.

Every building is composed on a 16px-native canvas and upscaled x4, so all
doorways land at one consistent zoom by construction. Roofs are recoloured
from the buildings sheet's blue shingle ramp to per-building ramps sampled
from the tileset's coloured roof blocks; window glass is tinted to match
(the tileset's own colour blocks tint their glass the same way).
"""

from __future__ import annotations

import io
from pathlib import Path

from PIL import Image, ImageDraw

from common import GAMEMAKER, SCALE, Sources, crop_tiles, paste, save_png, upscale

# Bounding boxes of the useful components in SUNNYSIDE_WORLD_BUILDINGS_V0.01.png
# (x0, y0, x1, y1 inclusive), catalogued by eye from the sheet.
PIECES = {
    "house_wide": (93, 121, 178, 175),  # 86x55 big gable house, skylight, door hole
    "tower_tall": (89, 28, 118, 108),  # 30x81 spire tower with legs
    "house_small": (13, 129, 66, 172),  # 54x44 gable house with arch door
    "house_narrow": (143, 21, 172, 75),  # 30x55 narrow tall house, glass stripe
    "storey": (41, 64, 70, 108),  # 30x45 wooden storey with two windows
    "hall_open": (41, 10, 70, 60),  # 30x51 glass-front hall with arch
    "barn_front": (13, 184, 66, 207),  # 54x24 awning wall with wide arch
    "hut": (129, 80, 158, 102),  # 30x23 tiny complete facade
    "tower_top_c": (238, 27, 257, 57),  # 20x31 dormer tower top
    "sign_small": (240, 128, 271, 139),  # 32x12 wooden board
    "ladder_tall": (256, 144, 271, 175),  # 16x32
    "ladder": (272, 73, 287, 98),  # 16x26 orange-rung ladder
    "porch_roof": (161, 101, 190, 111),  # 30x11 gable cap with window
    "shutter_red": (16, 48, 31, 59),
    "shutter_tan": (16, 64, 31, 75),
    "shutter_blue": (16, 80, 31, 91),
    "shutter_orange": (16, 96, 31, 107),
    "bracket": (273, 32, 286, 40),
    "vent_a": (2, 50, 12, 60),
    "vent_b": (3, 66, 11, 76),
    "lamp": (3, 80, 11, 93),
}

# Doorway holes are transparent in the sheet; each recipe backs them with this.
DOOR_DARK = (32, 28, 44, 255)

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


# Each recipe returns (image16px, door_height_16px, chimney_anchor_16px).
# door_height: doorway height in the composed 16px image (x4 when baked);
# chimney anchor: (x, y) where smoke should originate, in 16px canvas coords.


def build_library(kit: Kit):
    img = canvas(92, 61)
    house = kit.piece("house_wide")  # door hole x[35,50] y[39,54] within piece
    dark_rect(img, 3 + 35, 5 + 39, 3 + 50, 5 + 54)
    paste(img, house, 3, 5)
    shutter = kit.piece("shutter_blue")
    paste(img, shutter, 3 + 35, 5 + 55 - 12)
    # A little book pile on the ground beside the door — never on the roof.
    book1 = kit.gm("spr_deco_book_01")
    book2 = kit.gm("spr_deco_book_02")
    paste(img, book1, 57, 60 - book1.height)
    paste(img, book2, 64, 60 - book2.height)
    return img, 16, (46, 8)


def build_forge(kit: Kit):
    img = canvas(72, 52)
    house = kit.piece("house_small", "red")  # door hole x[19,34] y[31,43]
    dark_rect(img, 0 + 19, 6 + 31, 0 + 34, 6 + 43)
    paste(img, house, 0, 6)
    vent = kit.piece("vent_b")  # chimney sits ON the right roof slope
    paste(img, vent, 37, 9)
    anvil = kit.gm("spr_deco_anvil")
    paste(img, anvil, 49, 51 - anvil.height)
    return img, 13, (41, 9)


def build_tavern(kit: Kit):
    img = canvas(70, 54)
    house = kit.piece("house_small", "orange")  # door hole x[19,34] y[31,43]
    dark_rect(img, 0 + 19, 8 + 31, 0 + 34, 8 + 43)
    paste(img, house, 0, 8)
    barrel = kit.gm("spr_deco_barrel_closed")
    paste(img, barrel, 55, 52 - barrel.height)
    mug = kit.gm("spr_deco_mug_02")
    paste(img, mug, 58, 52 - barrel.height - mug.height + 1)
    barrel2 = kit.gm("spr_deco_barrel_open")
    paste(img, barrel2, 2, 52 - barrel2.height)
    return img, 13, (14, 11)


def build_alchemist(kit: Kit):
    img = canvas(48, 62)
    house = kit.piece("house_narrow", "green")  # door is drawn (opaque), no hole
    paste(img, house, 0, 6)
    jar1 = kit.gm("spr_deco_jar_01")
    jar2 = kit.gm("spr_deco_jar_02")
    paste(img, jar1, 33, 60 - jar1.height)
    paste(img, jar2, 41, 60 - jar2.height)
    return img, 12, (15, 8)


def build_chapel(kit: Kit):
    # Purple-roofed hall with a belfry on the ridge. The belfry pastes FIRST
    # so its base hides behind the roof and only the turret rises above it.
    img = canvas(56, 64)
    belfry = kit.piece("tower_top_c", "purple")
    paste(img, belfry, 17, 0)
    house = kit.piece("house_small", "purple")  # door hole x[19,34] y[31,43]
    dark_rect(img, 1 + 19, 20 + 31, 1 + 34, 20 + 43)
    paste(img, house, 1, 20)
    return img, 13, (27, 2)


def build_castle(kit: Kit):
    # Curtain wall (two full-width rows) between two battlement towers, wooden
    # gate at the centre, knight statue standing in front.
    img = canvas(96, 64)
    wall_top = kit.tiles(9, 15)
    wall_face = kit.tiles(9, 16)
    for x in range(0, 96, 16):
        paste(img, wall_top, x, 32)
        paste(img, wall_face, x, 48)
    tower = kit.tiles(44, 20, 2, 2)
    paste(img, tower, 0, 26)
    paste(img, tower, 64, 26)
    dark_rect(img, 40, 44, 55, 63)
    gate = kit.piece("shutter_tan")
    paste(img, gate, 40, 52)
    statue = kit.tiles(44, 18, 2, 2).crop((0, 0, 32, 26))
    sb = statue.getbbox()
    statue = statue.crop(sb)
    paste(img, statue, 20, 62 - statue.height)
    return img, 16, (16, 24)


def build_watchtower(kit: Kit):
    img = canvas(36, 96)
    storey = kit.piece("storey")
    body = storey.crop((0, 0, 30, 42))  # drop the baked-in grass at the base
    paste(img, storey, 3, 51)
    paste(img, body, 3, 22)
    top = kit.piece("tower_top_c")
    paste(img, top, 8, 0)
    return img, 12, (18, 2)


def build_arena(kit: Kit):
    img = canvas(72, 48)
    front = kit.piece("barn_front", "green")  # arch hole x[19,34] y[8,23]
    dark_rect(img, 0 + 19, 24 + 8, 0 + 34, 24 + 23)
    paste(img, front, 0, 24)
    # Full roof (ridge to eaves) sits over the front's top with a 2px lap so
    # the junction is the roof's own eave trim, not a bare wall band.
    roof = kit.piece("house_small", "green").crop((0, 0, 54, 20))
    paste(img, roof, 0, 6)
    swords = kit.gm("spr_deco_barrel_swords")
    paste(img, swords, 57, 47 - swords.height)
    sword = kit.gm("spr_deco_sword_floor")
    paste(img, sword, 58, 24)
    return img, 15, (27, 7)


BUILDING_RECIPES = {
    "library": build_library,
    "forge": build_forge,
    "tavern": build_tavern,
    "alchemist": build_alchemist,
    "chapel": build_chapel,
    "castle": build_castle,
    "watchtower": build_watchtower,
    "arena": build_arena,
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
    meta: dict = {"doorHeight": {}, "size": {}, "chimney": {}}
    for name, recipe in BUILDING_RECIPES.items():
        img, door_h, chimney = recipe(kit)
        baked = upscale(img)
        save_png(baked, out_dir / "buildings" / f"{name}.png")
        meta["doorHeight"][name] = door_h * SCALE
        meta["size"][name] = [baked.width, baked.height]
        meta["chimney"][name] = [chimney[0] * SCALE, chimney[1] * SCALE]
    for color in SITE_COLORS:
        save_png(upscale(build_site_house(kit, color)), out_dir / "buildings" / f"house-{color}.png")
    save_png(upscale(build_scaffold(kit)), out_dir / "buildings" / "site-scaffold.png")
    return meta
