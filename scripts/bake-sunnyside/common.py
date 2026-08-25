"""Shared plumbing for the Sunnyside World bake.

The bake reads the two purchased pack zips directly (nothing is extracted into
the repo) and writes processed PNGs under client/public/assets/themes/sunnyside/.
Requires Pillow; stdlib otherwise. Run via scripts/bake-sunnyside/bake.py.
"""

from __future__ import annotations

import io
import zipfile
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

TILE = 16  # native tile size of spr_tileset_sunnysideworld_16px.png
SCALE = 4  # world upscale: 16px art -> 64px world tiles

PACK_PREFIX = "Sunnyside_World_ASSET_PACK_V2.1/"
ASSETS = PACK_PREFIX + "Sunnyside_World_Assets/"
GAMEMAKER = PACK_PREFIX + "Sunnyside_World_Gamemaker/"


@dataclass
class Sources:
    """Open handles on the two source zips (plus the nested buildings zip)."""

    pack: zipfile.ZipFile
    archived: zipfile.ZipFile

    @classmethod
    def open(cls, pack_path: Path, archived_path: Path) -> "Sources":
        return cls(zipfile.ZipFile(pack_path), zipfile.ZipFile(archived_path))

    def image(self, path: str) -> Image.Image:
        """PNG from the main pack, path relative to Sunnyside_World_Assets/."""
        return Image.open(io.BytesIO(self.pack.read(ASSETS + path))).convert("RGBA")

    def gamemaker_image(self, path: str) -> Image.Image:
        """PNG from the main pack's GameMaker project."""
        return Image.open(io.BytesIO(self.pack.read(GAMEMAKER + path))).convert("RGBA")

    def buildings_sheet(self) -> Image.Image:
        """The native 640x640 modular buildings sheet from the archived zip."""
        inner = zipfile.ZipFile(
            io.BytesIO(self.archived.read("SUNNYSIDE_WORLD_BUILDINGS_V0.01.zip"))
        )
        return Image.open(
            io.BytesIO(inner.read("SUNNYSIDE_WORLD_BUILDINGS_V0.01.png"))
        ).convert("RGBA")


def upscale(img: Image.Image, k: int = SCALE) -> Image.Image:
    return img.resize((img.width * k, img.height * k), Image.NEAREST)


def tile_rect(tx: int, ty: int, tw: int = 1, th: int = 1) -> tuple[int, int, int, int]:
    """Pixel rect for a tile-coordinate region of the 16px tileset."""
    return (tx * TILE, ty * TILE, (tx + tw) * TILE, (ty + th) * TILE)


def crop_tiles(sheet: Image.Image, tx: int, ty: int, tw: int = 1, th: int = 1) -> Image.Image:
    return sheet.crop(tile_rect(tx, ty, tw, th))


def content_bbox(img: Image.Image) -> tuple[int, int, int, int]:
    bbox = img.getbbox()
    if bbox is None:
        raise ValueError("image is fully transparent")
    return bbox


def palette_swap(img: Image.Image, mapping: dict[tuple[int, int, int], tuple[int, int, int]]) -> Image.Image:
    """Exact-RGB palette swap, preserving alpha. Pixel art only — no blending."""
    out = img.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            repl = mapping.get((r, g, b))
            if repl is not None:
                px[x, y] = (repl[0], repl[1], repl[2], a)
    return out


def colors_used(img: Image.Image) -> set[tuple[int, int, int]]:
    px = img.load()
    seen: set[tuple[int, int, int]] = set()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = px[x, y]
            if a > 0:
                seen.add((r, g, b))
    return seen


def ramp_by_luminance(colors: set[tuple[int, int, int]]) -> list[tuple[int, int, int]]:
    """Order a colour set dark -> light so two ramps can be paired rank-by-rank."""
    return sorted(colors, key=lambda c: 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2])


def save_png(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True)


def paste(dst: Image.Image, src: Image.Image, x: int, y: int) -> None:
    """Alpha-composite src onto dst at (x, y)."""
    dst.alpha_composite(src, (x, y))
