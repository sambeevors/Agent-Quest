"""Bake scenery and ambience sprites.

Animated pieces (trees, mushrooms, animals) become horizontal spritesheets;
static pieces become single images. Everything is upscaled x4 to match the
64px world, and content-cropped where the source tile has large margins.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

from common import Sources, crop_tiles, save_png, upscale

TILESET = "Tileset/spr_tileset_sunnysideworld_16px.png"

# Static pieces cut from the tileset: name -> (tx, ty, tw, th)
STATIC_TILES = {
    "bush-1": (27, 1, 1, 1),
    "bush-2": (28, 4, 1, 1),
    "bush-3": (29, 3, 1, 1),
    "rock-1": (48, 21, 3, 2),
    "rock-2": (51, 21, 3, 2),
    "rock-3": (53, 21, 2, 2),
    "rock-4": (55, 22, 1, 1),
    "rock-5": (53, 29, 2, 2),
    "flower-1": (33, 1, 1, 1),
    "flower-2": (33, 2, 1, 1),
    "flower-3": (33, 3, 1, 1),
    "stump-1": (31, 5, 1, 1),
    "stump-2": (32, 5, 1, 1),
}

# Animated strips from Elements/: name -> (path, frame count). Frame size is
# measured (the strips vary — tree_02 is 28x43 while tree_01 is 32x34).
# Trees deliberately come ONLY from these animated strips: the tileset's
# static trees sit flush against their neighbours, so any crop either clips
# the canopy or drags a stranger in — and a forest where some trees sway and
# some are frozen reads as broken anyway. Variants 3/4 are palette-shifted
# copies of 1/2, so every tree moves.
ANIMATED = {
    "tree-1": ("Elements/Plants/spr_deco_tree_01_strip4.png", 4),
    "tree-2": ("Elements/Plants/spr_deco_tree_02_strip4.png", 4),
    "mushroom-1": ("Elements/Plants/spr_deco_mushroom_red_01_strip4.png", 4),
    "mushroom-2": ("Elements/Plants/spr_deco_mushroom_blue_01_strip4.png", 4),
    "mushroom-3": ("Elements/Plants/spr_deco_mushroom_blue_02_strip4.png", 4),
    "mushroom-4": ("Elements/Plants/spr_deco_mushroom_blue_03_strip4.png", 4),
    # Land critters (animal-1..5) wander the meadow; the duck is its own key
    # and lives on the water.
    "animal-1": ("Elements/Animals/spr_deco_chicken_01_strip4.png", 4),
    "animal-2": ("Elements/Animals/spr_deco_cow_strip4.png", 4),
    "animal-3": ("Elements/Animals/spr_deco_sheep_01_strip4.png", 4),
    "animal-4": ("Elements/Animals/spr_deco_pig_01_strip4.png", 4),
    "animal-5": ("Elements/Animals/spr_deco_bird_01_strip4.png", 4),
    "duck": ("Elements/Animals/spr_deco_duck_01_strip4.png", 4),
}

# Crop patches: soil tile + a grown crop, composed 2x2 soil with 4 plants.
CROP_PATCHES = {
    "crop-1": "pumpkin_04",
    "crop-2": "sunflower_04",
    "crop-3": "cabbage_04",
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


def bake_scenery(src: Sources, out_dir: Path) -> dict:
    ts = src.image(TILESET)
    meta: dict = {"animated": {}}

    for name, (tx, ty, tw, th) in STATIC_TILES.items():
        img = crop_tiles(ts, tx, ty, tw, th)
        bbox = img.getbbox()
        if bbox is None:
            raise AssertionError(f"{name}: empty tile region")
        save_png(upscale(img.crop(bbox)), out_dir / "scenery" / f"{name}.png")

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

    # Darker-foliage copies of the two animated trees, so a wood has variety
    # without any frozen trees.
    for src_name, dst_name in (("tree-1", "tree-3"), ("tree-2", "tree-4")):
        path, frames = ANIMATED[src_name]
        strip = src.image(path)
        dark = _shift_foliage(strip)
        save_png(upscale(dark), out_dir / "scenery" / f"{dst_name}.png")
        meta["animated"][dst_name] = {
            "frames": frames,
            "frameWidth": strip.width // frames * 4,
            "frameHeight": strip.height * 4,
        }

    soil = src.image("Elements/Crops/soil_01.png")
    for name, crop in CROP_PATCHES.items():
        plant = src.image(f"Elements/Crops/{crop}.png")
        patch = Image.new("RGBA", (soil.width * 2, soil.height * 2))
        for gy in range(2):
            for gx in range(2):
                patch.alpha_composite(soil, (gx * soil.width, gy * soil.height))
        for gy in range(2):
            for gx in range(2):
                px = gx * soil.width + (soil.width - plant.width) // 2
                py = gy * soil.height + soil.height - plant.height - 1
                patch.alpha_composite(plant, (px, py))
        save_png(upscale(patch), out_dir / "scenery" / f"{name}.png")

    return meta
