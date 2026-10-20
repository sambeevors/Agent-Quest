"""Bake the Sunnyside UI kit for the React overlay.

- The three 9-slice box colourways (white / light / dark) are reassembled from
  their 9 pieces into single 3x3 images usable as CSS border-image sources.
- The wooden label plate is assembled left+middle+right.
- Expression and tool icons are copied straight through.
Everything stays at native 1x: CSS displays these at integer multiples with
image-rendering: pixelated, which keeps them crisp on any DPR; a pre-upscaled
source would force fractional downscales instead.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

from common import Sources, paste, save_png

BOX_PREFIXES = {"box-white": "w", "box-light": "lt", "box-dark": "dt"}
BOX_GRID = [["tl", "tc", "tr"], ["lc", "c", "rc"], ["bl", "bc", "br"]]

ICONS = [
    "expression_alerted",
    "expression_chat",
    "expression_confused",
    "expression_love",
    "expression_stress",
    "expression_working",
    "expression_attack",
    "sandtimer",
    "stopwatch",
    "hammer",
    "axe",
    "pickaxe",
    "shovel",
    "rod",
    "sword",
    "basket",
    "plant",
    "water",
    "confirm",
    "cancel",
]


def bake_ui(src: Sources, out_dir: Path) -> dict:
    meta: dict = {}
    for out_name, prefix in BOX_PREFIXES.items():
        pieces = {
            pos: src.image(f"UI/9slice_box_white/{prefix}_box_9slice_{pos}.png")
            for row in BOX_GRID
            for pos in row
        }
        cw = pieces["tl"].width
        ch = pieces["tl"].height
        for pos, img in pieces.items():
            if img.size != (cw, ch):
                raise AssertionError(f"9slice {prefix}/{pos}: {img.size} != {(cw, ch)}")
        box = Image.new("RGBA", (cw * 3, ch * 3))
        for gy, row in enumerate(BOX_GRID):
            for gx, pos in enumerate(row):
                paste(box, pieces[pos], gx * cw, gy * ch)
        save_png(box, out_dir / f"{out_name}.png")
        meta[out_name] = {"slice": cw}

    left = src.image("UI/label_left.png")
    middle = src.image("UI/label_middle.png")
    right = src.image("UI/label_right.png")
    label = Image.new("RGBA", (left.width + middle.width + right.width, left.height))
    paste(label, left, 0, 0)
    paste(label, middle, left.width, 0)
    paste(label, right, left.width + middle.width, 0)
    save_png(label, out_dir / "label.png")
    meta["label"] = {"slice": [left.width, right.width], "height": left.height}

    for icon in ICONS:
        img = src.image(f"UI/{icon}.png")
        save_png(img, out_dir / f"{icon.replace('_', '-')}.png")
    return meta
