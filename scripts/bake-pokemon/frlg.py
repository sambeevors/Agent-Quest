"""Reads FireRed/LeafGreen map data from a pret/pokefirered checkout.

The decomp stores every overworld map as metatile ids (`map.bin`), each
metatile as eight 8x8 tile references (`metatiles.bin`: bottom layer TL TR BL
BR, then top layer), each tile as 4bpp indices into `tiles.png`, and colour as
JASC palettes. Primary tilesets own tiles/metatiles 0-639 and palettes 0-6;
the secondary (per-town) tileset owns everything above.
"""
from __future__ import annotations

import json
import struct
from pathlib import Path

from PIL import Image

PRIMARY_TILES = 640
PRIMARY_METATILES = 640
PRIMARY_PALETTES = 7


def _snake(name: str) -> str:
    """gTileset_PalletTown -> pallet_town"""
    out = ''
    for i, ch in enumerate(name.removeprefix('gTileset_')):
        if ch.isupper() and i > 0:
            out += '_'
        out += ch.lower()
    return out.replace('123', '_123').replace('45', '_45').replace('67', '_67')


def _read_pal(path: Path) -> list[tuple[int, int, int, int]]:
    lines = path.read_text().split()
    count = int(lines[2])
    vals = list(map(int, lines[3:3 + count * 3]))
    return [(vals[i * 3], vals[i * 3 + 1], vals[i * 3 + 2], 255) for i in range(count)]


class Tileset:
    def __init__(self, root: Path, kind: str, name: str):
        d = root / 'data' / 'tilesets' / kind / _snake(name)
        self.tiles = Image.open(d / 'tiles.png')
        if self.tiles.mode != 'P':
            raise ValueError(f'{d}/tiles.png is not indexed')
        self.ntiles = (self.tiles.width // 8) * (self.tiles.height // 8)
        raw = (d / 'metatiles.bin').read_bytes()
        self.metatiles = [struct.unpack_from('<8H', raw, i) for i in range(0, len(raw), 16)]
        self.palettes = [_read_pal(d / 'palettes' / f'{i:02}.pal') for i in range(16)]

    def tile(self, index: int) -> Image.Image:
        cols = self.tiles.width // 8
        x, y = (index % cols) * 8, (index // cols) * 8
        return self.tiles.crop((x, y, x + 8, y + 8))


class MapRenderer:
    def __init__(self, root: Path, primary: str, secondary: str):
        self.primary = Tileset(root, 'primary', primary)
        self.secondary = Tileset(root, 'secondary', secondary)
        pals = self.primary.palettes[:PRIMARY_PALETTES] + self.secondary.palettes[PRIMARY_PALETTES:]
        self.palettes = pals
        self._cache: dict[tuple[int, bool], Image.Image] = {}

    def _tile(self, entry: int) -> Image.Image:
        index = entry & 0x3FF
        hflip = bool(entry & 0x400)
        vflip = bool(entry & 0x800)
        pal = self.palettes[(entry >> 12) & 0xF]
        if index < PRIMARY_TILES:
            src = self.primary.tile(index) if index < self.primary.ntiles else None
        else:
            j = index - PRIMARY_TILES
            src = self.secondary.tile(j) if j < self.secondary.ntiles else None
        out = Image.new('RGBA', (8, 8), (0, 0, 0, 0))
        if src is None:
            return out
        px = src.load()
        o = out.load()
        for y in range(8):
            for x in range(8):
                c = px[x, y]
                if c != 0:
                    o[x, y] = pal[c]
        if hflip:
            out = out.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        if vflip:
            out = out.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
        return out

    def metatile(self, mid: int, layers: str = 'both') -> Image.Image:
        """16x16 RGBA metatile. layers: 'bottom' | 'top' | 'both'."""
        key = (mid, layers)
        if key in self._cache:
            return self._cache[key]
        if mid < PRIMARY_METATILES:
            entries = self.primary.metatiles[mid]
        else:
            entries = self.secondary.metatiles[mid - PRIMARY_METATILES]
        img = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
        spans = {'bottom': (0,), 'top': (1,), 'both': (0, 1)}[layers]
        for layer in spans:
            for k in range(4):
                t = self._tile(entries[layer * 4 + k])
                img.alpha_composite(t, ((k % 2) * 8, (k // 2) * 8))
        self._cache[key] = img
        return img


class Layout:
    def __init__(self, root: Path, name: str):
        layouts = json.loads((root / 'data' / 'layouts' / 'layouts.json').read_text())['layouts']
        spec = next(l for l in layouts if l.get('name') == name)
        self.width = spec['width']
        self.height = spec['height']
        raw = (root / spec['blockdata_filepath']).read_bytes()
        self.blocks = [v & 0x3FF for (v,) in struct.iter_unpack('<H', raw)]
        self.renderer = MapRenderer(root, spec['primary_tileset'], spec['secondary_tileset'])

    def block(self, x: int, y: int) -> int:
        return self.blocks[y * self.width + x]

    def render(self, rect: tuple[int, int, int, int] | None = None, backdrop: tuple[int, int, int, int] | None = None,
               layers: str = 'both') -> Image.Image:
        """Render a block-space rect (x, y, w, h) to a 16px-per-block image."""
        x0, y0, w, h = rect if rect is not None else (0, 0, self.width, self.height)
        img = Image.new('RGBA', (w * 16, h * 16), backdrop or (0, 0, 0, 0))
        for y in range(h):
            for x in range(w):
                img.alpha_composite(self.renderer.metatile(self.block(x0 + x, y0 + y), layers), (x * 16, y * 16))
        return img
