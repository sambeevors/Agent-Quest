"""Bake scenery and ambience sprites.

Only creatures animate: the animal strips become horizontal spritesheets for
the wandering critters. Everything botanical or mineral is baked STATIC —
trees and mushrooms take frame 0 of their strips — because plants that dance
in a world with no wind read as noise, not ambience. Everything is upscaled
x4 to match the 64px world, and content-cropped where the source tile has
large margins.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

from common import Sources, crop_tiles, save_png, upscale

TILESET = "Tileset/spr_tileset_sunnysideworld_16px.png"

# Static pieces cut from the tileset on the 16px grid: name -> (tx, ty, tw, th)
STATIC_TILES = {
    "bush-1": (27, 1, 1, 1),
    "bush-2": (28, 4, 1, 1),
    "bush-3": (29, 3, 1, 1),
    "flower-1": (33, 1, 1, 1),
    "flower-2": (33, 2, 1, 1),
    "flower-3": (33, 3, 1, 1),
    "stump-1": (31, 5, 1, 1),
    "stump-2": (32, 5, 1, 1),
}

# Pieces whose artwork ignores the tile grid: name -> (x, y, w, h) in raw
# pixels. The five grey rocks overlap tile boundaries in the sheet, so any
# grid-aligned crop drags a neighbouring rock's edge in as a stray sliver —
# these rects are the connected-component bboxes of each rock, found by scan.
STATIC_PX = {
    "rock-1": (736, 320, 32, 27),
    "rock-2": (787, 340, 26, 25),
    "rock-3": (820, 343, 24, 22),
    "rock-4": (855, 349, 18, 16),
    "rock-5": (883, 355, 10, 10),
}

# Static foliage from Elements/ strips: name -> path. Frame 0 only — see the
# module docstring. Trees deliberately come from these strips rather than the
# tileset: the tileset's static trees sit flush against their neighbours, so
# any crop either clips the canopy or drags a stranger in. Variants 3/4 are
# palette-shifted copies of 1/2 for woodland variety.
STATIC_STRIPS = {
    "tree-1": "Elements/Plants/spr_deco_tree_01_strip4.png",
    "tree-2": "Elements/Plants/spr_deco_tree_02_strip4.png",
    "mushroom-1": "Elements/Plants/spr_deco_mushroom_red_01_strip4.png",
    "mushroom-2": "Elements/Plants/spr_deco_mushroom_blue_01_strip4.png",
    "mushroom-3": "Elements/Plants/spr_deco_mushroom_blue_02_strip4.png",
    "mushroom-4": "Elements/Plants/spr_deco_mushroom_blue_03_strip4.png",
}
STRIP_FRAMES = 4  # every _strip4 source

# Animated strips: name -> (path, frame count). Creatures only — land
# critters (animal-1..5) wander the meadow; the duck is its own key and
# lives on the water.
ANIMATED = {
    "animal-1": ("Elements/Animals/spr_deco_chicken_01_strip4.png", 4),
    "animal-2": ("Elements/Animals/spr_deco_cow_strip4.png", 4),
    "animal-3": ("Elements/Animals/spr_deco_sheep_01_strip4.png", 4),
    "animal-4": ("Elements/Animals/spr_deco_pig_01_strip4.png", 4),
    "animal-5": ("Elements/Animals/spr_deco_bird_01_strip4.png", 4),
    "duck": ("Elements/Animals/spr_deco_duck_01_strip4.png", 4),
}


def _shift_foliage(img: Image.Image) -> Image.Image:
    """Darker, slightly warmer copy of a tree strip (greens only)."""
    out = img.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            if g > r and g > b:  # foliage pixel
                px[x, y] = (min(255, int(r * 0.92 + 10)), int(g * 0.82), int(b * 0.80), a)
    return out


def _first_frame(strip: Image.Image, frames: int) -> Image.Image:
    if strip.width % frames != 0:
        raise AssertionError(f"strip {strip.size} not divisible into {frames} frames")
    fw = strip.width // frames
    return strip.crop((0, 0, fw, strip.height))


def bake_scenery(src: Sources, out_dir: Path) -> dict:
    ts = src.image(TILESET)
    meta: dict = {"animated": {}}

    for name, (tx, ty, tw, th) in STATIC_TILES.items():
        img = crop_tiles(ts, tx, ty, tw, th)
        bbox = img.getbbox()
        if bbox is None:
            raise AssertionError(f"{name}: empty tile region")
        save_png(upscale(img.crop(bbox)), out_dir / "scenery" / f"{name}.png")

    for name, (x, y, w, h) in STATIC_PX.items():
        img = ts.crop((x, y, x + w, y + h))
        if img.getbbox() is None:
            raise AssertionError(f"{name}: empty pixel region")
        save_png(upscale(img), out_dir / "scenery" / f"{name}.png")

    for name, path in STATIC_STRIPS.items():
        frame = _first_frame(src.image(path), STRIP_FRAMES)
        save_png(upscale(frame), out_dir / "scenery" / f"{name}.png")

    # Darker-foliage copies of the two trees for woodland variety.
    for src_name, dst_name in (("tree-1", "tree-3"), ("tree-2", "tree-4")):
        frame = _first_frame(src.image(STATIC_STRIPS[src_name]), STRIP_FRAMES)
        save_png(upscale(_shift_foliage(frame)), out_dir / "scenery" / f"{dst_name}.png")

    for name, (path, frames) in ANIMATED.items():
        strip = src.image(path)
        if strip.width % frames != 0:
            raise AssertionError(f"{name}: {strip.size} not divisible into {frames} frames")
        save_png(upscale(strip), out_dir / "scenery" / f"{name}.png")
        meta["animated"][name] = {
            "frames": frames,
            "frameWidth": strip.width // frames * 4,
            "frameHeight": strip.height * 4,
        }

    return meta
