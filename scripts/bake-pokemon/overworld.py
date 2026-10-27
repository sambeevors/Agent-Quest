"""FireRed overworld sprites (trainers, overworld Pokémon) with their real palettes.

A pic PNG in the decomp carries a placeholder palette; the game recolours it
with whichever palette its ObjectEventGraphicsInfo names. This module resolves
pic file -> palette tag -> .pal by reading the decomp's C tables.
"""
from __future__ import annotations

import re
from pathlib import Path

from PIL import Image

from frlg import _read_pal

PAL_FILES: dict[str, str | None] = {
    'OBJ_EVENT_PAL_TAG_PLAYER': 'player.pal',
    'OBJ_EVENT_PAL_TAG_PLAYER_RED': 'player.pal',
    # Leaf's pic already carries her own palette; None keeps the embedded one.
    'OBJ_EVENT_PAL_TAG_PLAYER_GREEN': None,
    'OBJ_EVENT_PAL_TAG_NPC_BLUE': 'npc_blue.pal',
    'OBJ_EVENT_PAL_TAG_NPC_PINK': 'npc_pink.pal',
    'OBJ_EVENT_PAL_TAG_NPC_GREEN': 'npc_green.pal',
    'OBJ_EVENT_PAL_TAG_NPC_WHITE': 'npc_white.pal',
}

# Standard 9-frame order of a 16x32 walker (pic table indices).
STAND = {'down': 0, 'up': 1, 'left': 2}
WALK = {'down': (3, 4), 'up': (5, 6), 'left': (7, 8)}


class Overworld:
    def __init__(self, root: Path):
        self.root = root
        src = root / 'src' / 'data' / 'object_events'
        gfx = (src / 'object_event_graphics.h').read_text()
        # gObjectEventPic_X -> png path
        self.pic_path = {
            m[1]: m[2].replace('.4bpp', '.png')
            for m in re.finditer(r'(gObjectEventPic_\w+)\[\] = INCBIN_U16\("([^"]+)"\)', gfx)
        }
        tables = (src / 'object_event_pic_tables.h').read_text()
        # sPicTable_X -> first pic referenced
        table_pic = {
            m[1]: m[2]
            for m in re.finditer(r'(sPicTable_\w+)\[\] = \{\s*overworld_frame\((gObjectEventPic_\w+)', tables)
        }
        info = (src / 'object_event_graphics_info.h').read_text()
        self.pic_palette: dict[str, str] = {}
        for m in re.finditer(r'gObjectEventGraphicsInfo_\w+ = \{(.*?)\};', info, re.S):
            body = m[1]
            tag = re.search(r'\.paletteTag = (\w+)', body)
            images = re.search(r'\.images = (sPicTable_\w+)', body)
            if tag and images and images[1] in table_pic:
                pic = table_pic[images[1]]
                path = self.pic_path.get(pic)
                if path and tag[1] in PAL_FILES:
                    self.pic_palette.setdefault(path, tag[1])

    def load(self, rel: str) -> Image.Image:
        """Load graphics/object_events/pics/<rel>.png recoloured, as RGBA."""
        path = f'graphics/object_events/pics/{rel}.png'
        im = Image.open(self.root / path)
        tag = self.pic_palette.get(path)
        if tag is None:
            raise KeyError(f'no palette for {path}')
        im = im.copy()
        if PAL_FILES[tag] is not None:
            pal = _read_pal(self.root / 'graphics' / 'object_events' / 'palettes' / PAL_FILES[tag])
            flat: list[int] = []
            for r, g, b, _ in pal:
                flat += [r, g, b]
            im.putpalette(flat + [0] * (768 - len(flat)))
        rgba = im.convert('RGBA')
        px = im.load()
        out = rgba.load()
        for y in range(im.height):
            for x in range(im.width):
                if px[x, y] == 0:
                    out[x, y] = (0, 0, 0, 0)
        return rgba


def frames(sheet: Image.Image, w: int, h: int) -> list[Image.Image]:
    return [sheet.crop((i * w, 0, i * w + w, h)) for i in range(sheet.width // w)]


def walker_sheet(sheet: Image.Image, w: int = 16, h: int = 32) -> Image.Image:
    """Re-lay a 9-frame walker as 12 frames with right-facing ones mirrored in:
    down stand/walk1/walk2, up ..., left ..., right ...  (3 per direction)."""
    f = frames(sheet, w, h)
    flip = lambda im: im.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    order = []
    for d in ('down', 'up', 'left'):
        order += [f[STAND[d]], f[WALK[d][0]], f[WALK[d][1]]]
    order += [flip(f[STAND['left']]), flip(f[WALK['left'][0]]), flip(f[WALK['left'][1]])]
    out = Image.new('RGBA', (w * 12, h), (0, 0, 0, 0))
    for i, im in enumerate(order):
        out.alpha_composite(im, (i * w, 0))
    return out
