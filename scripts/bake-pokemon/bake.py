"""Bake the Pokémon (FireRed/LeafGreen) theme into Agent Quest's asset tree.

Usage:
  python3 scripts/bake-pokemon/bake.py --firered <pret/pokefirered checkout> --pokeapi <PokeAPI/sprites checkout>

Educational/non-commercial fork only: the art belongs to Nintendo / Game
Freak / The Pokémon Company. Two sources, neither copied into the repo:

- pret/pokefirered (the FireRed decompilation) for everything that isn't a
  Pokémon: towns are rendered straight from the decomp's map data
  (`frlg.py`), buildings are cropped out of real towns, terrain/road/shore
  sheets are composed from the general tileset's metatiles, and trainers come
  from its overworld sprite pics with their in-game palettes (`overworld.py`).
- PokeAPI/sprites for the Pokémon: Gen III party icons (wild Pokémon, partners
  and the arena's residents).

A sparse checkout is enough:
  firered: data/tilesets data/layouts graphics/object_events graphics/trainers src/data/object_events
  pokeapi: sprites/pokemon/versions/generation-iii/icons

Writes PNGs under client/public/assets/themes/pokemon/ and the generated
metadata at client/src/game/themes/pokemon-sheet.ts. Requires Pillow.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))

from frlg import Layout, MapRenderer, _read_pal  # noqa: E402
from overworld import Overworld, walker_sheet  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / 'client/public/assets/themes/pokemon'
GENERATED_TS = REPO / 'client/src/game/themes/pokemon-sheet.ts'

BLOCK = 16
# Every map-derived asset is baked at x2, so one 16px metatile is 32 world px
# at render scale 1 — the road cell size, and half a 64px terrain cell.
Z = 2

# ---------------------------------------------------------------------------
# Metatile ids (general tileset — shared by every Kanto town)
# ---------------------------------------------------------------------------
GRASS = 0x01
GRASS_TUFTS = [0x08, 0x09, 0x10, 0x11]
FLOWER = 0x04
CUT_BUSH = 0x05
TALL_GRASS = 0x0D
TREE = [[0x0E, 0x0F], [0x24, 0x25]]
# Sand path 9-slice: corner/edge pieces fringed with grass.
SAND = {
    'tl': 0xD3, 't': 0xD4, 'tr': 0xD5,
    'l': 0xDB, 'c': 0xDC, 'r': 0xDD,
    'bl': 0xE3, 'b': 0xE4, 'br': 0xE5,
}
WATER = 0x12B
WATER_VARIANTS = [0x1D0, 0x1D1, 0x1D2, 0x1E0]
# Pallet's pond rim (rocky lip along the top edge of the water).
POND_RIM_TOP = 0x123
# The white picket fence ring around Viridian's woods.
FENCE = {'tl': 0xEC, 'tr': 0xED, 'l': 0xF4, 'r': 0xF5, 'bl': 0xFC, 'br': 0xFD, 'h': 0xE7}
BOARDWALK = 0x1BE  # Vermilion's harbour planks

# ---------------------------------------------------------------------------
# Buildings: (layout, block rect x y w h, transparent blocks padded left/right
# so the door sits on the image's centre line — Building anchors bottom-centre)
# ---------------------------------------------------------------------------
BUILDINGS = {
    # idle / waiting — rest and heal
    'tavern': ('ViridianCity', (24, 22, 5, 5), 0, 0),
    # debugging — potions and antidotes
    'alchemist': ('ViridianCity', (34, 16, 4, 4), 0, 1),
    # thinking — Prof. Oak ponders
    'castle': ('PalletTown', (13, 9, 7, 5), 0, 0),
    # reviewing — the Gym Leader judges the challenger
    'watchtower': ('CeruleanCity', (28, 17, 7, 5), 0, 0),
    # reading — the Trainer School
    'library': ('ViridianCity', (24, 8, 5, 4), 2, 0),
    # editing — the Bike Shop builds and repairs
    'forge': ('CeruleanCity', (11, 23, 5, 6), 0, 1),
}

# Door rect (native px, relative to the padded crop) — darkened to an open
# doorway while a trainer is inside, the way a FireRed door swings open.
DOORS = {
    'tavern': (34, 64, 12, 16),
    'alchemist': (34, 50, 12, 14),
    'castle': (50, 64, 12, 13),
    'watchtower': (52, 64, 12, 16),
    'library': (49, 48, 13, 15),
    'forge': (24, 85, 52, 10),
}

BUILDING_LABELS = {
    'tavern': 'Pokémon Center',
    'alchemist': 'Poké Mart',
    'castle': "Oak's Lab",
    'watchtower': 'Pokémon Gym',
    'library': 'Trainer School',
    'forge': 'Bike Shop',
    'arena': 'Tall Grass',
    'farm': 'Flower Garden',
}

# ---------------------------------------------------------------------------
# Trainers: (class, colour) -> (overworld pic, trainer front pic)
# ---------------------------------------------------------------------------
TRAINERS = {
    'warrior': {  # the famous faces of Kanto (and a couple of visitors from Hoenn)
        'red': ('red_normal', 'red'),
        'blue': ('blue', 'rival_early'),
        'yellow': ('rs_brendan', 'ruby_sapphire_brendan'),
        'black': ('giovanni', 'leader_giovanni'),
        'purple': ('lorelei', 'elite_four_lorelei'),
        'teal': ('green_normal', 'leaf'),
        'orange': ('rs_may', 'ruby_sapphire_may'),
        'green': ('prof_oak', 'professor_oak'),
    },
    'archer': {  # the aces
        'red': ('cooltrainer_f', 'cool_trainer_f'),
        'blue': ('swimmer_m_land', 'swimmer_m'),
        'yellow': ('youngster', 'youngster'),
        'black': ('cooltrainer_m', 'cool_trainer_m'),
        'purple': ('channeler', 'channeler'),
        'teal': ('tuber_f', 'tuber_f'),
        'orange': ('hiker', 'hiker'),
        'green': ('bug_catcher', 'bug_catcher'),
    },
    'pawn': {  # trainer classes met on the routes
        'red': ('lass', 'lass'),
        'blue': ('sailor', 'sailor'),
        'yellow': ('picnicker', 'picnicker'),
        'black': ('black_belt', 'black_belt'),
        'purple': ('poke_maniac', 'pokemaniac'),
        'teal': ('beauty', 'beauty'),
        'orange': ('camper', 'camper'),
        'green': ('scientist', 'scientist'),
    },
}
COLORS = ['red', 'blue', 'yellow', 'black', 'purple', 'teal', 'orange', 'green']
# Codex sessions are Team Rocket.
ROCKET = ('rocket_m', 'rocket_grunt_m')

# ---------------------------------------------------------------------------
# Pokémon (national dex numbers, PokeAPI Gen III icons)
# ---------------------------------------------------------------------------
WILD = [16, 19, 10, 43, 39]  # Pidgey, Rattata, Caterpie, Oddish, Jigglypuff
SWIMMER = 54  # Psyduck paddles the pond (the theme's "duck")
ARENA = [19, 21]  # Rattata and Spearow lurk in the tall grass
# Partners walking at their trainer's heels — picked per agent by hash.
PARTNERS = [
    25, 1, 4, 7, 133, 52, 35, 39, 37, 58, 63, 66, 74, 77, 79, 92, 95, 104, 113, 116,
    123, 129, 131, 137, 143, 147, 152, 155, 158, 175,
]


def scale(img: Image.Image, k: int = Z) -> Image.Image:
    return img.resize((img.width * k, img.height * k), Image.NEAREST)


def save(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True)


def ground_colours(r: MapRenderer, ids: list[int]) -> set[tuple[int, int, int, int]]:
    out: set[tuple[int, int, int, int]] = set()
    for m in ids:
        out |= {c for _, c in r.metatile(m).getcolors(1024) or [] if c[3] == 255}
    return out


def strip_ground(img: Image.Image, colours: set) -> Image.Image:
    """Flood from the border through ground-coloured pixels and clear them."""
    img = img.copy()
    px = img.load()
    w, h = img.size
    stack = [(x, y) for x in range(w) for y in (0, h - 1)] + [(x, y) for y in range(h) for x in (0, w - 1)]
    seen = set()
    while stack:
        x, y = stack.pop()
        if (x, y) in seen or not (0 <= x < w and 0 <= y < h):
            continue
        seen.add((x, y))
        c = px[x, y]
        if c[3] == 0 or c in colours:
            px[x, y] = (0, 0, 0, 0)
            stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
    return img


def town_ground_ids(layout: Layout) -> list[int]:
    """The most common non-tree metatiles of a town are its open ground."""
    # Trees, and fences/signs: white fence paint is the same white as a
    # Gym's walls, and the flood would eat straight through them.
    trees = {0x0E, 0x0F, *range(0x14, 0x28), *range(0xDE, 0x100)}
    common = [m for m, _ in Counter(layout.blocks).most_common(24) if m not in trees]
    return common + [GRASS, *GRASS_TUFTS, *SAND.values()]


def compose(r: MapRenderer, grid: list[list[int | None]], layers: str = 'both') -> Image.Image:
    img = Image.new('RGBA', (len(grid[0]) * BLOCK, len(grid) * BLOCK), (0, 0, 0, 0))
    for y, row in enumerate(grid):
        for x, m in enumerate(row):
            if m is not None:
                img.alpha_composite(r.metatile(m, layers), (x * BLOCK, y * BLOCK))
    return img


def bbox_extent(img: Image.Image) -> tuple[int, int]:
    """(top opaque row, row below the lowest opaque pixel)."""
    box = img.getchannel('A').getbbox()
    return (box[1], box[3]) if box else (0, img.height)


# ---------------------------------------------------------------------------


def bake_buildings(root: Path, out: Path, layouts: dict[str, Layout]) -> dict:
    meta: dict = {'interior': {}, 'crops': {}, 'door': {}, 'size': {}}
    for bid, (town, (x, y, w, h), pad_l, pad_r) in BUILDINGS.items():
        L = layouts[town]
        img = L.render((x, y, w, h))
        img = strip_ground(img, ground_colours(L.renderer, town_ground_ids(L)))
        padded = Image.new('RGBA', ((w + pad_l + pad_r) * BLOCK, h * BLOCK), (0, 0, 0, 0))
        padded.alpha_composite(img, (pad_l * BLOCK, 0))
        save(scale(padded), out / 'buildings' / f'{bid}.png')
        dx, dy, dw, dh = DOORS[bid]
        door = Image.new('RGBA', padded.size, (0, 0, 0, 0))
        dark = Image.new('RGBA', (dw, dh), (16, 16, 24, 255))
        # A sliver of light at the threshold, like FireRed's open door.
        dark.paste((48, 48, 64, 255), (0, dh - 2, dw, dh))
        door.alpha_composite(dark, (dx, dy))
        save(scale(door), out / 'buildings' / f'{bid}-open.png')
        meta['door'][bid] = [dx * Z, dy * Z, dw * Z, dh * Z]
        meta['size'][bid] = [padded.width * Z, padded.height * Z]

    r = layouts['ViridianCity'].renderer
    gcols = ground_colours(r, [GRASS, *GRASS_TUFTS, TALL_GRASS])

    def fence_ring(w: int, h: int) -> list[list[int | None]]:
        grid: list[list[int | None]] = [[None] * w for _ in range(h)]
        grid[0] = [FENCE['tl']] + [FENCE['h']] * (w - 2) + [FENCE['tr']]
        for yy in range(1, h - 1):
            grid[yy][0] = FENCE['l']
            grid[yy][w - 1] = FENCE['r']
        bottom: list[int | None] = [FENCE['bl']] + [FENCE['h']] * (w - 2) + [FENCE['br']]
        gate = w // 2
        bottom[gate] = None
        grid[h - 1] = bottom
        return grid

    # Arena (bash): a fenced patch of tall grass where wild Pokémon wait.
    aw, ah = 7, 5
    ring = strip_ground(compose(r, fence_ring(aw, ah)), gcols)
    floor = [[GRASS] * aw for _ in range(ah)]
    for yy in range(1, ah - 1):
        for xx in range(1, aw - 1):
            floor[yy][xx] = TALL_GRASS
    save(scale(ring), out / 'buildings' / 'arena.png')
    save(scale(compose(r, floor)), out / 'buildings' / 'arena-ground.png')
    meta['interior']['arena'] = [BLOCK * Z, BLOCK * Z, (aw - 2) * BLOCK * Z, (ah - 2) * BLOCK * Z]
    meta['size']['arena'] = [aw * BLOCK * Z, ah * BLOCK * Z]

    # Farm (git): a fenced flower garden — trainers water the beds.
    fw, fh = 7, 6
    ring = strip_ground(compose(r, fence_ring(fw, fh)), gcols)
    floor = [[GRASS] * fw for _ in range(fh)]
    crops = []
    for yy in (1, 3):
        for xx in (1, 3, 5):
            floor[yy][xx] = FLOWER
            floor[yy + 1][xx] = FLOWER
            crops.append([(xx * BLOCK + BLOCK // 2) * Z, ((yy + 1) * BLOCK + BLOCK // 2) * Z])
    for xx in range(1, fw - 1):
        for yy in range(1, fh - 1):
            if floor[yy][xx] == GRASS:
                floor[yy][xx] = SAND['c']
    save(scale(ring), out / 'buildings' / 'farm.png')
    save(scale(compose(r, floor)), out / 'buildings' / 'farm-ground.png')
    meta['interior']['farm'] = [BLOCK * Z, BLOCK * Z, (fw - 2) * BLOCK * Z, (fh - 2) * BLOCK * Z]
    meta['crops']['farm'] = crops
    meta['size']['farm'] = [fw * BLOCK * Z, fh * BLOCK * Z]
    return meta


def bake_terrain(out: Path, layouts: dict[str, Layout]) -> dict:
    r = layouts['CeruleanCity'].renderer
    mt = r.metatile

    def cell(ids: list[list[int]]) -> Image.Image:
        return scale(compose(r, ids))  # 2x2 blocks at x2 = one 64px terrain cell

    # grass.png — frame 0 plain, 1-4 tufted, 5 a transparent tuft decal.
    frames = [cell([[GRASS, GRASS], [GRASS, GRASS]])]
    for i, t in enumerate(GRASS_TUFTS):
        grid = [[GRASS, GRASS], [GRASS, GRASS]]
        grid[i // 2][i % 2] = t
        frames.append(cell(grid))
    plain = mt(GRASS)
    tuft = mt(GRASS_TUFTS[0]).copy()
    tp, pp = tuft.load(), plain.load()
    for yy in range(BLOCK):
        for xx in range(BLOCK):
            if tp[xx, yy] == pp[xx, yy]:
                tp[xx, yy] = (0, 0, 0, 0)
    deco = Image.new('RGBA', (BLOCK * 2, BLOCK * 2), (0, 0, 0, 0))
    deco.alpha_composite(tuft, (BLOCK // 2, BLOCK // 2))
    frames.append(scale(deco))
    sheet = Image.new('RGBA', (64 * len(frames), 64), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        sheet.alpha_composite(f, (i * 64, 0))
    save(sheet, out / 'terrain' / 'grass.png')

    # meadow.png — 8x8 blocks (256 world px), mostly plain grass.
    meadow = [[GRASS] * 8 for _ in range(8)]
    for (xx, yy, t) in [(1, 1, 0), (5, 2, 1), (2, 5, 2), (6, 6, 3), (4, 4, 0), (7, 0, 2)]:
        meadow[yy][xx] = GRASS_TUFTS[t]
    save(scale(compose(r, meadow)), out / 'terrain' / 'meadow.png')

    # road.png — the 4x4 edge block path-tiles.ts expects, built per 8x8
    # quadrant from the sand path's own 9-slice so every edge is FireRed's.
    def quadrant(m: int, q: int) -> Image.Image:
        x, y = (q % 2) * 8, (q // 2) * 8
        return mt(m).crop((x, y, x + 8, y + 8))

    def piece(v: str, h: str) -> int:
        key = (v + h) if (v and h) else (v or h or 'c')
        return SAND[key]

    rows = [('t',), (), ('b',), ('t', 'b')]
    cols = [('l',), (), ('r',), ('l', 'r')]
    road = Image.new('RGBA', (64 * 6, 64 * 4), (0, 0, 0, 0))
    for ry, vs in enumerate(rows):
        for cx, hs in enumerate(cols):
            tile = Image.new('RGBA', (BLOCK, BLOCK))
            for q in range(4):
                v = ('t' if 't' in vs else '') if q < 2 else ('b' if 'b' in vs else '')
                h = ('l' if 'l' in hs else '') if q % 2 == 0 else ('r' if 'r' in hs else '')
                tile.alpha_composite(quadrant(piece(v, h), q), ((q % 2) * 8, (q // 2) * 8))
            road.alpha_composite(scale(tile, 4), (cx * 64, ry * 64))
    # 4: surface accent (plain sand — FireRed paths are clean), 5: verge tuft.
    road.alpha_composite(scale(mt(SAND['c']), 4), (4 * 64, 0))
    road.alpha_composite(scale(tuft, 4), (5 * 64, 0))
    save(road, out / 'terrain' / 'road.png')

    # water.png — 5 frames (village.json paints frames 0-4).
    wframes = [cell([[WATER, WATER], [WATER, WATER]])]
    for v in WATER_VARIANTS:
        wframes.append(cell([[WATER, v], [v, WATER]]))
    sheet = Image.new('RGBA', (64 * len(wframes), 64))
    for i, f in enumerate(wframes):
        sheet.alpha_composite(f, (i * 64, 0))
    save(sheet, out / 'terrain' / 'water.png')

    # shore.png — SHORE_FRAME order: edges n e s w (decals on the land cell,
    # water on that side), then cuts nw ne sw se (opaque, water in that half).
    pallet = layouts['PalletTown'].renderer
    rim = pallet.metatile(POND_RIM_TOP).crop((0, 0, BLOCK, 5))
    rim_strip = Image.new('RGBA', (BLOCK * 2, 5))
    rim_strip.alpha_composite(rim, (0, 0))
    rim_strip.alpha_composite(rim, (BLOCK, 0))
    edge_n = Image.new('RGBA', (BLOCK * 2, BLOCK * 2), (0, 0, 0, 0))
    edge_n.alpha_composite(rim_strip.transpose(Image.Transpose.FLIP_TOP_BOTTOM), (0, 0))
    edges = {
        'n': edge_n,
        's': edge_n.transpose(Image.Transpose.FLIP_TOP_BOTTOM),
        'w': edge_n.transpose(Image.Transpose.TRANSPOSE),
        'e': edge_n.transpose(Image.Transpose.TRANSPOSE).transpose(Image.Transpose.FLIP_LEFT_RIGHT),
    }
    grass2 = compose(r, [[GRASS, GRASS], [GRASS, GRASS]])
    water2 = compose(r, [[WATER, WATER], [WATER, WATER]])
    rim_c = rim.getpixel((8, 1))
    cuts = {}
    for corner in ('nw', 'ne', 'sw', 'se'):
        img = grass2.copy()
        wp, ip = water2.load(), img.load()
        n = BLOCK * 2
        for yy in range(n):
            for xx in range(n):
                u = xx if 'w' in corner else n - 1 - xx
                v = yy if 'n' in corner else n - 1 - yy
                if u + v < n - 1:
                    ip[xx, yy] = wp[xx, yy]
                elif u + v < n + 1:
                    ip[xx, yy] = rim_c
        cuts[corner] = img
    shore = [edges[s] for s in 'nesw'] + [cuts[c] for c in ('nw', 'ne', 'sw', 'se')]
    sheet = Image.new('RGBA', (64 * 8, 64), (0, 0, 0, 0))
    for i, f in enumerate(shore):
        sheet.alpha_composite(scale(f), (i * 64, 0))
    save(sheet, out / 'terrain' / 'shore.png')

    # bridge.png — a north-south boardwalk, one terrain cell wide in the
    # middle of a 3x3-cell (192px) image, like the Sunnyside jetty.
    planks = layouts['VermilionCity'].renderer.metatile(BOARDWALK).transpose(Image.Transpose.ROTATE_90)
    deck = Image.new('RGBA', (BLOCK * 6, BLOCK * 6), (0, 0, 0, 0))
    for yy in range(6):
        for xx in (2, 3):
            deck.alpha_composite(planks, (xx * BLOCK, yy * BLOCK))
    edge = (74, 57, 41, 255)
    for yy in range(BLOCK * 6):
        deck.putpixel((BLOCK * 2, yy), edge)
        deck.putpixel((BLOCK * 4 - 1, yy), edge)
    save(scale(deck), out / 'terrain' / 'bridge.png')
    return {}


def bake_scenery(root: Path, pokeapi: Path, out: Path, layouts: dict[str, Layout], ow: Overworld) -> dict:
    r = layouts['ViridianCity'].renderer
    gcols = ground_colours(r, [GRASS, *GRASS_TUFTS])
    sizes: dict[str, list[int]] = {}

    def put(key: str, img: Image.Image) -> None:
        img = scale(img)
        save(img, out / 'scenery' / f'{key}.png')
        sizes[key] = [img.width, img.height]

    tree = strip_ground(compose(r, TREE), gcols)
    for i in range(1, 5):
        put(f'tree-{i}', tree)
    bush = strip_ground(compose(r, [[CUT_BUSH]]), gcols)
    for i in range(1, 4):
        put(f'bush-{i}', bush)
    flower = strip_ground(compose(r, [[FLOWER]]), gcols)
    for i in range(1, 4):
        put(f'flower-{i}', flower)
    grass = compose(r, [[TALL_GRASS]])
    for i in range(1, 5):
        put(f'mushroom-{i}', grass)
    boulder = trim(ow.load('misc/strength_boulder'))
    smash = trim(ow.load('misc/rock_smash_rock'))
    for i, img in enumerate([boulder, boulder, smash, smash, boulder], start=1):
        put(f'rock-{i}', img)
    cut = trim(ow.load('misc/cut_tree'))
    for i in range(1, 3):
        put(f'stump-{i}', cut)

    animated: dict[str, dict] = {}
    for i, dex in enumerate(WILD, start=1):
        strip = icon_strip(pokeapi, dex)
        save(scale(strip), out / 'scenery' / f'animal-{i}.png')
        animated[f'animal-{i}'] = {'frameWidth': 32 * Z, 'frameHeight': 32 * Z, 'frames': 2}
        sizes[f'animal-{i}'] = [32 * Z, 32 * Z]
    save(scale(icon_strip(pokeapi, SWIMMER)), out / 'scenery' / 'duck.png')
    animated['duck'] = {'frameWidth': 32 * Z, 'frameHeight': 32 * Z, 'frames': 2}
    return {'artSize': sizes, 'animated': animated}


def trim(img: Image.Image) -> Image.Image:
    """First 16x16 (or 32x32) frame of a misc object pic, cropped to its art."""
    side = min(img.width, img.height)
    frame = img.crop((0, 0, side, side))
    box = frame.getchannel('A').getbbox()
    return frame.crop(box) if box else frame


def load_icon(pokeapi: Path, dex: int) -> Image.Image:
    im = Image.open(pokeapi / 'sprites/pokemon/versions/generation-iii/icons' / f'{dex}.png')
    return im.convert('RGBA')


def icon_strip(pokeapi: Path, dex: int) -> Image.Image:
    """Two frames: the icon, and the icon one pixel lower — the party-menu hop."""
    icon = load_icon(pokeapi, dex)
    strip = Image.new('RGBA', (64, 32), (0, 0, 0, 0))
    strip.alpha_composite(icon, (0, 0))
    strip.alpha_composite(icon.crop((0, 0, 32, 31)), (32, 1))
    return strip


def bake_pokemon(pokeapi: Path, out: Path) -> dict:
    # Arena residents: idle hop, then a lunge-and-flash attack loop.
    arena = []
    for i, dex in enumerate(ARENA, start=1):
        icon = load_icon(pokeapi, dex)
        flash = icon.copy()
        fp = flash.load()
        for yy in range(32):
            for xx in range(32):
                if fp[xx, yy][3]:
                    fp[xx, yy] = (248, 248, 248, 255)
        frames = [(icon, 0, 0), (icon, 0, 1), (icon, -4, 0), (flash, -4, 0)]
        sheet = Image.new('RGBA', (32 * len(frames), 32), (0, 0, 0, 0))
        for j, (im, dx, dy) in enumerate(frames):
            sheet.alpha_composite(im.crop((max(0, -dx), 0, 32, 32 - dy)), (j * 32 + max(0, dx), dy))
        save(sheet, out / 'heroes' / f'wild-{i}.png')
        head, foot = bbox_extent(icon)
        arena.append({'key': f'wild-{i}', 'headY': head, 'footY': foot})
    # Partners — two-frame hop strips, like the wild ones. Icons sit on a
    # common baseline, so one extent (the typical one) serves them all.
    heads, feet = [], []
    for dex in PARTNERS:
        save(icon_strip(pokeapi, dex), out / 'partners' / f'{dex}.png')
        head, foot = bbox_extent(load_icon(pokeapi, dex))
        heads.append(head)
        feet.append(foot)
    heads.sort()
    feet.sort()
    extent = {'frameHeight': 32, 'headY': heads[len(heads) // 2], 'footY': feet[len(feet) // 2]}
    return {'arena': arena, 'partners': PARTNERS, 'partnerExtent': extent}


def bake_trainers(root: Path, out: Path, ow: Overworld) -> dict:
    heads, feet = [], []

    def one(pic: str, front: str, key: str) -> None:
        sheet = ow.load(f'people/{pic}')
        if sheet.width < 16 * 9:
            raise ValueError(f'{pic} has no walk cycle ({sheet.width}px wide)')
        walker = walker_sheet(sheet)
        save(walker, out / 'heroes' / f'{key}.png')
        h, f = bbox_extent(walker.crop((0, 0, 16, 32)))
        heads.append(h)
        feet.append(f)
        save(portrait(root, front), out / 'heroes' / f'portrait-{key}.png')

    for unit, by_colour in TRAINERS.items():
        for colour, (pic, front) in by_colour.items():
            one(pic, front, f'{unit}-{colour}')
    one(*ROCKET, 'rocket')
    return {
        'frameWidth': 16, 'frameHeight': 32, 'columns': 12,
        'headY': min(heads), 'footY': max(feet),
        'classes': list(TRAINERS), 'colors': COLORS,
    }


def portrait(root: Path, name: str) -> Image.Image:
    im = Image.open(root / f'graphics/trainers/front_pics/{name}_front_pic.png')
    pal = root / f'graphics/trainers/palettes/{name}.pal'
    im = im.copy()
    if pal.exists():
        flat = [c for rgb in _read_pal(pal) for c in rgb[:3]]
        im.putpalette(flat + [0] * (768 - len(flat)))
    idx = im.load()
    rgba = im.convert('RGBA')
    o = rgba.load()
    for yy in range(im.height):
        for xx in range(im.width):
            if idx[xx, yy] == 0:
                o[xx, yy] = (0, 0, 0, 0)
    # Square-crop to the figure so the React avatar shows the trainer's face.
    box = rgba.getchannel('A').getbbox() or (0, 0, 64, 64)
    side = min(64, max(box[2] - box[0], 40))
    cx = (box[0] + box[2]) // 2
    left = max(0, min(64 - side, cx - side // 2))
    return scale(rgba.crop((left, box[1], left + side, box[1] + side)).resize((48, 48), Image.NEAREST))


UI_OUT = REPO / 'client/public/assets/ui/pokemon'


def bake_ui() -> None:
    """9-slice frames for the React panels, in FireRed's menu style.

    Drawn rather than ripped: the game's window frames are 8px tiles built for
    a white text box, and every panel here keeps the app's dark interior (its
    text palette is tuned for it). So this is the battle text box's look — a
    dark slate centre in a rounded frame — at native 1x, 4px slices, for CSS
    border-image with image-rendering: pixelated.
    """
    def frame(rings: list[tuple[int, int, int, int]], fill: tuple[int, int, int, int]) -> Image.Image:
        n = len(rings)
        size = n * 2 + 1
        img = Image.new('RGBA', (size, size), fill)
        px = img.load()
        for y in range(size):
            for x in range(size):
                d = min(x, y, size - 1 - x, size - 1 - y)
                if d < n:
                    px[x, y] = rings[d]
        # Round the corners: knock out the outermost corner pixel and pull the
        # second ring in to meet the outline.
        for cx, cy in ((0, 0), (size - 1, 0), (0, size - 1), (size - 1, size - 1)):
            px[cx, cy] = (0, 0, 0, 0)
            ix = 1 if cx == 0 else size - 2
            iy = 1 if cy == 0 else size - 2
            px[ix, iy] = rings[0]
        return img

    outline = (40, 48, 64, 255)
    white = (248, 248, 248, 255)
    blue = (104, 144, 176, 255)
    slate = (40, 56, 80, 255)
    save(frame([outline, white, blue, slate], slate), UI_OUT / 'box.png')
    # Header plate: FireRed's white text window — dark text on white.
    save(frame([outline, (200, 208, 216, 255), white, white], white), UI_OUT / 'plate.png')


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--firered', type=Path, default=REPO / '.context/dl/firered')
    ap.add_argument('--pokeapi', type=Path, default=REPO / '.context/dl/pokeapi')
    ap.add_argument('--out', type=Path, default=OUT)
    args = ap.parse_args()

    layouts = {
        n: Layout(args.firered, f'{n}_Layout')
        for n in ('PalletTown', 'ViridianCity', 'CeruleanCity', 'VermilionCity')
    }
    ow = Overworld(args.firered)
    meta = {
        'heroes': bake_trainers(args.firered, args.out, ow),
        'buildings': bake_buildings(args.firered, args.out, layouts),
        'scenery': bake_scenery(args.firered, args.pokeapi, args.out, layouts, ow),
        'pokemon': bake_pokemon(args.pokeapi, args.out),
        'labels': BUILDING_LABELS,
    }
    bake_terrain(args.out, layouts)
    bake_ui()
    (args.out / 'bake-meta.json').write_text(json.dumps(meta, indent=2) + '\n')
    GENERATED_TS.write_text(
        '// GENERATED by scripts/bake-pokemon/bake.py — do not edit by hand.\n'
        f'export const POKEMON_SHEET = {json.dumps(meta, indent=2)} as const;\n'
    )


if __name__ == '__main__':
    main()
