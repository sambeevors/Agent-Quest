"""Cerulean City, exactly as FireRed draws it — plus the edges of its routes.

The town is rendered block for block from the decomp's `map.bin`, with the
four connected routes (Nugget Bridge to the north, Route 4 west to Mt. Moon,
Route 9 east, Route 5 south) placed at their real connection offsets, and
the town's own border pattern filling whatever the routes don't reach — the
same rule the game uses past the edge of a map.

Two images come out, because FireRed draws around its sprites rather than
under them: `ground.png` holds everything below the sprite layer and
`overhead.png` the top tile layer of NORMAL/SPLIT metatiles (roof eaves, tree
crowns), so a trainer walking behind a tree is hidden by its canopy.

Movement comes from the same data the game moves on: a block is walkable when
its collision bits are clear and its behaviour isn't water or a ledge. Only the
part reachable from the spawn is kept — the flower garden north of the Badge
House is reached through its back door in the game, so here it's scenery.
"""
from __future__ import annotations

import json
from collections import deque
from pathlib import Path

from PIL import Image

from frlg import Layout
from overworld import Overworld

TOWN = 'CeruleanCity'
# Blocks of route drawn around the town on every side.
MARGIN = 12
BLOCK = 16

ROUTES = {'MAP_ROUTE24': 'Route24', 'MAP_ROUTE5': 'Route5', 'MAP_ROUTE4': 'Route4', 'MAP_ROUTE9': 'Route9'}

WATER = range(0x10, 0x1C)       # MB_POND_WATER .. MB_CYCLING_ROAD_WATER
DIRECTIONAL = range(0x30, 0x3C)  # MB_IMPASSABLE_* and MB_JUMP_* (ledges)

# Door metatile -> (door_anims png, palette slot), from sDoorAnimGraphicsTable
# in src/field_door.c. The Bike Shop's door (0x296) has no animation.
DOOR_ANIMS = {
    0x298: ('cerulean', 12),
    0x062: ('sliding_single', 3),
    0x15B: ('sliding_double', 3),
    0x03D: ('general', 2),
}

# Where each activity happens, in town block coordinates. `doors` are the
# map's warp tiles; `rect` is the building's footprint (click target, label
# anchor). Ids are the activity slots the rest of the app already knows.
BUILDINGS = {
    'tavern': {'label': 'Pokémon Center', 'doors': [(22, 19)], 'rect': (20, 15, 5, 5)},
    'alchemist': {'label': 'Poké Mart', 'doors': [(29, 28)], 'rect': (27, 25, 4, 4)},
    'watchtower': {'label': 'Cerulean Gym', 'doors': [(31, 21)], 'rect': (28, 17, 7, 5)},
    # The bike rack is part of the shop: x 11 holds the three bikes.
    # The flower bed sits right above it, so its name goes on its own roof.
    'forge': {'label': 'Bike Shop', 'doors': [(13, 28), (14, 28)], 'rect': (11, 23, 5, 6), 'label_inside': True},
    'library': {'label': 'Trade House', 'doors': [(15, 17)], 'rect': (13, 14, 7, 4)},
    'castle': {'label': 'Badge House', 'doors': [(10, 11)], 'rect': (8, 8, 7, 4)},
}

# The arena is Nugget Bridge: heroes line up on the planks, the bridge's
# Pokémon face them from further north. Town coords (the bridge is Route 24,
# above the town's top edge, so y is negative).
BRIDGE = {'label': 'Nugget Bridge', 'cols': (22, 24), 'rows': (-5, 1), 'fighters': [(22, -7), (24, -8)]}

# The farm is the flower bed beside the Bike Shop: its trainers tend the
# flowers. Every walkable block in the rect is a bed.
GARDEN = {'label': 'Flower Bed', 'rect': (11, 21, 6, 2)}

# Heroes arrive the way the player first does: along Route 4 from Mt. Moon.
SPAWN_EDGE = 'west'

# The view the camera opens on — the town, with a glimpse of the bridge.
VIEW = (2, -6, 44, 44)

SLOTS_PER_BUILDING = 12


class World:
    def __init__(self, root: Path):
        self.root = root
        self.town = Layout(root, f'{TOWN}_Layout')
        self.cols = self.town.width + 2 * MARGIN
        self.rows = self.town.height + 2 * MARGIN
        # (x, y) world block -> (layout, local x, local y)
        self.cells: dict[tuple[int, int], tuple[Layout, int, int]] = {}
        spec = json.loads((root / 'data' / 'maps' / TOWN / 'map.json').read_text())
        for c in spec['connections']:
            route = Layout(root, ROUTES[c['map']] + '_Layout')
            off = c['offset']
            origin = {
                'up': (off, -route.height),
                'down': (off, self.town.height),
                'left': (-route.width, off),
                'right': (self.town.width, off),
            }[c['direction']]
            self._place(route, *origin)
        self._place(self.town, 0, 0)
        # Cut trees are object events, not blocks: drawn and blocked here.
        self.cut_trees = [
            (o['x'] + MARGIN, o['y'] + MARGIN)
            for o in spec['object_events'] if o['graphics_id'] == 'OBJ_EVENT_GFX_CUT_TREE'
        ]
        self.cut_trees = [p for p in self.cut_trees if self.inside(*p)]

    def _place(self, layout: Layout, ox: int, oy: int) -> None:
        for y in range(layout.height):
            for x in range(layout.width):
                wx, wy = ox + x + MARGIN, oy + y + MARGIN
                if self.inside(wx, wy):
                    self.cells[(wx, wy)] = (layout, x, y)

    def inside(self, x: int, y: int) -> bool:
        return 0 <= x < self.cols and 0 <= y < self.rows

    @staticmethod
    def world(x: int, y: int) -> tuple[int, int]:
        """Town block -> world block."""
        return x + MARGIN, y + MARGIN

    def metatile(self, x: int, y: int) -> tuple[Layout, int]:
        cell = self.cells.get((x, y))
        if cell is None:
            border = self.town.border
            return self.town, border[(y % 2) * 2 + (x % 2)]
        layout, lx, ly = cell
        return layout, layout.block(lx, ly)

    def passable(self, x: int, y: int) -> bool:
        cell = self.cells.get((x, y))
        if cell is None or (x, y) in self.cut_trees:
            return False
        layout, lx, ly = cell
        behavior = layout.renderer.behavior(layout.block(lx, ly))
        return layout.collision(lx, ly) == 0 and behavior not in WATER and behavior not in DIRECTIONAL

    def render(self, layers: str) -> Image.Image:
        img = Image.new('RGBA', (self.cols * BLOCK, self.rows * BLOCK), (0, 0, 0, 0))
        for y in range(self.rows):
            for x in range(self.cols):
                layout, mid = self.metatile(x, y)
                img.alpha_composite(layout.renderer.metatile(mid, layers), (x * BLOCK, y * BLOCK))
        return img

    def door_open_frame(self, x: int, y: int) -> Image.Image | None:
        """The last (fully open) frame of a door's animation, in the map's palette."""
        layout, mid = self.metatile(x, y)
        anim = DOOR_ANIMS.get(mid)
        if anim is None:
            return None
        name, slot = anim
        sheet = Image.open(self.root / 'graphics' / 'door_anims' / f'{name}.png')
        frame = sheet.crop((0, sheet.height - BLOCK, BLOCK, sheet.height))
        pal = layout.renderer.palettes[slot]
        out = Image.new('RGBA', (BLOCK, BLOCK), (0, 0, 0, 0))
        src, dst = frame.load(), out.load()
        for yy in range(BLOCK):
            for xx in range(BLOCK):
                c = src[xx, yy] & 0xF
                if c:
                    dst[xx, yy] = pal[c]
        return out


def reachable(world: World, start: tuple[int, int]) -> set[tuple[int, int]]:
    seen = {start}
    queue = deque([start])
    while queue:
        x, y = queue.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if (nx, ny) not in seen and world.passable(nx, ny):
                seen.add((nx, ny))
                queue.append((nx, ny))
    return seen


def spawn_tile(world: World) -> tuple[int, int]:
    assert SPAWN_EDGE == 'west'
    column = [y for y in range(world.rows) if world.passable(0, y)]
    if not column:
        raise ValueError('no walkable block on the west edge')
    return 0, column[len(column) // 2]


def crowd(walk: set[tuple[int, int]], stands: list[tuple[int, int]], taken: set[tuple[int, int]],
          count: int) -> list[tuple[int, int]]:
    """The blocks a crowd fills in front of a door: the stand tiles first, then
    outward by walking distance, nearest the door's column first."""
    dist = {s: 0 for s in stands}
    queue = deque(stands)
    while queue:
        x, y = queue.popleft()
        if dist[(x, y)] >= 4:
            continue
        for n in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if n in walk and n not in dist:
                dist[n] = dist[(x, y)] + 1
                queue.append(n)
    cx = sum(s[0] for s in stands) / len(stands)
    order = sorted(dist, key=lambda p: (dist[p], abs(p[0] - cx), -p[1], p[0]))
    return [p for p in order if p not in taken][:count]


def bake_town(root: Path, out: Path, scale) -> dict:
    world = World(root)
    ow = Overworld(root)

    ground = world.render('below')
    cut_tree = ow.load('misc/cut_tree').crop((0, 0, BLOCK, BLOCK))
    for x, y in world.cut_trees:
        ground.alpha_composite(cut_tree, (x * BLOCK, y * BLOCK))
    overhead = world.render('above')
    (out / 'town').mkdir(parents=True, exist_ok=True)
    scale(ground).save(out / 'town' / 'ground.png', optimize=True)
    scale(overhead).save(out / 'town' / 'overhead.png', optimize=True)

    spawn = spawn_tile(world)
    walk = reachable(world, spawn)

    # The flower bed is the farm's own ground: no door's crowd spills onto it.
    gx, gy, gw, gh = GARDEN['rect']
    beds = [world.world(x, y) for y in range(gy, gy + gh) for x in range(gx, gx + gw)]
    beds = [b for b in beds if b in walk]

    taken: set[tuple[int, int]] = set(beds)
    buildings: dict[str, dict] = {}
    # Every door's step is reserved up front, so no crowd spills onto another
    # building's doorstep.
    for spec in BUILDINGS.values():
        for dx, dy in spec['doors']:
            taken.add(world.world(dx, dy + 1))
    for bid, spec in BUILDINGS.items():
        doors = [world.world(*d) for d in spec['doors']]
        stands = [(x, y + 1) for x, y in doors]
        for s in stands:
            if s not in walk:
                raise ValueError(f'{bid}: door step {s} is not walkable')
            taken.discard(s)
        slots = crowd(walk, stands, taken, SLOTS_PER_BUILDING)
        taken.update(slots)
        overlays = []
        for x, y in doors:
            frame = world.door_open_frame(x, y)
            if frame is None:
                continue
            name = f'door-{bid}-{len(overlays)}'
            scale(frame).save(out / 'town' / f'{name}.png', optimize=True)
            overlays.append({'key': name, 'tile': [x, y]})
        rx, ry, rw, rh = spec['rect']
        buildings[bid] = {
            'label': spec['label'],
            'rect': [*world.world(rx, ry), rw, rh],
            'doors': [list(d) for d in doors],
            'slots': [list(s) for s in slots],
            'doorOverlays': overlays,
            'labelInside': spec.get('label_inside', False),
        }

    # Nugget Bridge: planks nearest the Pokémon first, so a lone trainer
    # squares up to them with a tile between for its partner to fight in, and
    # a crowd queues back down the bridge towards the town.
    c0, c1 = BRIDGE['cols']
    r0, r1 = BRIDGE['rows']
    middle = (c0 + c1) / 2
    across = sorted(range(c0, c1 + 1), key=lambda x: (abs(x - middle), x))
    planks = [world.world(x, y) for y in range(r0, r1 + 1) for x in across]
    planks = [p for p in planks if p in walk]
    fighters = [world.world(*f) for f in BRIDGE['fighters']]
    for f in fighters:
        if f not in walk:
            raise ValueError(f'bridge fighter spot {f} is not on the bridge')
    xs = [p[0] for p in planks]
    ys = [p[1] for p in planks + fighters]
    buildings['arena'] = {
        'label': BRIDGE['label'],
        'rect': [min(xs), min(ys) - 1, max(xs) - min(xs) + 1, max(ys) - min(ys) + 2],
        'doors': [],
        'slots': [list(p) for p in planks],
        'doorOverlays': [],
        'labelInside': False,
        'fighters': [list(f) for f in fighters],
    }

    buildings['farm'] = {
        'label': GARDEN['label'],
        'rect': [*world.world(gx, gy), gw, gh],
        'doors': [],
        'slots': [list(b) for b in beds],
        'doorOverlays': [],
        'labelInside': False,
    }

    rows = [''.join('.' if (x, y) in walk else '#' for x in range(world.cols)) for y in range(world.rows)]
    vx, vy, vw, vh = VIEW
    return {
        'name': 'Cerulean City',
        'cols': world.cols,
        'rows': world.rows,
        'walk': rows,
        'spawn': list(spawn),
        'view': [*world.world(vx, vy), vw, vh],
        'buildings': buildings,
    }
