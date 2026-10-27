"""Bake hero spritesheets: composite base + hair (+ tools), palette-swap the shirt.

Output per (class, colour): one grid sheet, one row per animation, 23 columns
(the widest animation), 96x64 native frames. Plus a content-cropped portrait
PNG per (class, colour) for the React avatars.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

from common import Sources, paste, save_png, upscale

FRAME_W, FRAME_H = 96, 64
COLUMNS = 23

# (name, human dir, file stem, frame count, needs tools layer)
ANIMS: list[tuple[str, str, str, int, bool]] = [
    ("walk", "WALKING", "walk", 8, False),
    ("idle", "IDLE", "idle", 9, False),
    ("waiting", "WAITING", "waiting", 9, False),
    ("hammering", "HAMMERING", "hamering", 23, True),  # pack's own spelling
    ("attack", "ATTACK", "attack", 10, True),
    ("doing", "DOING", "doing", 8, False),
    ("mining", "MINING", "mining", 10, True),
    ("axe", "AXE", "axe", 10, True),
    ("watering", "WATERING", "watering", 5, True),
]

CLASS_HAIR = {
    "warrior": "spikeyhair",
    "archer": "longhair",
    "pawn": "bowlhair",
}

# The base sprite's shirt is red. Ramp order: shadow, base, highlight.
# The strips carry ±1-2 per-channel jitter, hence tolerance matching below —
# but the tolerance must stay below the distance to spikeyhair's reds
# (162,38,51)/(228,59,68)/(237,82,89), which are min 5 per-channel away.
SHIRT_SOURCE = [(165, 31, 51), (233, 50, 69), (250, 113, 122)]
SHIRT_TOLERANCE = 3

# Each hairstyle's own ramp (shadow, base, highlight) — the hair layer is
# recoloured to the hero colour as well, because at portrait size the hair is
# the only feature large enough to carry the colour identity. The class stays
# readable as the hairstyle's silhouette. Ramps only ever touch the hair
# layer, so palette collisions with boots/skin in the base layer are moot.
HAIR_SOURCE: dict[str, list[tuple[int, int, int]]] = {
    "spikeyhair": [(162, 38, 51), (228, 59, 68), (237, 82, 89)],
    "longhair": [(148, 69, 38), (224, 115, 23), (246, 147, 69)],
    "bowlhair": [(62, 38, 48), (117, 60, 57), (187, 109, 83)],
}

SHIRT_RAMPS: dict[str, list[tuple[int, int, int]]] = {
    "red": SHIRT_SOURCE,
    "blue": [(44, 86, 161), (62, 136, 222), (120, 183, 255)],
    "yellow": [(196, 134, 20), (244, 188, 41), (255, 224, 102)],
    "black": [(40, 42, 58), (74, 79, 102), (122, 128, 153)],
    "purple": [(108, 50, 148), (158, 86, 206), (206, 143, 240)],
    "teal": [(26, 118, 110), (52, 172, 160), (122, 224, 209)],
    "orange": [(188, 84, 18), (240, 128, 42), (255, 180, 102)],
    "green": [(44, 124, 54), (84, 178, 86), (146, 224, 134)],
}

GOBLIN_ANIM_FILES = {
    "walk": "spr_walk_strip8.png",
    "idle": "spr_idle_strip9.png",
    "waiting": "spr_waiting_strip9.png",
    "hammering": "spr_hammering_strip23.png",
    "attack": "spr_attack_strip10.png",
    "doing": "spr_doing_strip8.png",
    "mining": "spr_mining_strip10.png",
    "axe": "spr_axe_strip10.png",
    "watering": "spr_watering_strip5.png",
}


def _strip(src: Sources, layer: str, anim: tuple[str, str, str, int, bool]) -> Image.Image:
    _, dirname, stem, frames, _ = anim
    img = src.image(f"Characters/Human/{dirname}/{layer}_{stem}_strip{frames}.png")
    if img.size != (FRAME_W * frames, FRAME_H):
        raise AssertionError(f"{layer}_{stem}: unexpected strip size {img.size}")
    return img


def _swap_ramp(
    img: Image.Image,
    source: list[tuple[int, int, int]],
    ramp: list[tuple[int, int, int]],
) -> Image.Image:
    out = img.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            for i, (sr, sg, sb) in enumerate(source):
                if (
                    abs(r - sr) <= SHIRT_TOLERANCE
                    and abs(g - sg) <= SHIRT_TOLERANCE
                    and abs(b - sb) <= SHIRT_TOLERANCE
                ):
                    tr, tg, tb = ramp[i]
                    px[x, y] = (tr, tg, tb, a)
                    break
    return out


def _assert_shirt_present(base_idle: Image.Image) -> None:
    frame0 = base_idle.crop((0, 0, FRAME_W, FRAME_H))
    found = [False] * len(SHIRT_SOURCE)
    px = frame0.load()
    for y in range(FRAME_H):
        for x in range(FRAME_W):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            for i, (sr, sg, sb) in enumerate(SHIRT_SOURCE):
                if abs(r - sr) <= SHIRT_TOLERANCE and abs(g - sg) <= SHIRT_TOLERANCE and abs(b - sb) <= SHIRT_TOLERANCE:
                    found[i] = True
    if not all(found):
        raise AssertionError(
            f"shirt ramp not fully present in base idle frame 0: {found} — pack changed?"
        )


def _square_portrait(frame: Image.Image, pad: int = 1) -> Image.Image:
    bbox = frame.getbbox()
    if bbox is None:
        raise AssertionError("portrait frame is empty")
    content = frame.crop(
        (
            max(0, bbox[0] - pad),
            max(0, bbox[1] - pad),
            min(frame.width, bbox[2] + pad),
            min(frame.height, bbox[3] + pad),
        )
    )
    side = max(content.width, content.height)
    square = Image.new("RGBA", (side, side))
    square.alpha_composite(content, ((side - content.width) // 2, side - content.height))
    return square


# Rows a character's standing extent is measured over. Only the body poses:
# the tool animations swing a hammer or pick well above the head (row 8 of a
# 64-row frame), and a label hung off THAT would float as far over the hero as
# the frame top it replaced.
BODY_ANIMS = ("walk", "idle")


def _body_extent(sheet: Image.Image, rows: dict[str, int], frames: dict[str, int]) -> tuple[int, int]:
    """(headY, footY) of the character in frame pixels, over every frame of the
    body rows: headY is the topmost opaque row, footY the row just below the
    lowest opaque one — the ground line the feet stand on.

    The frames are 96x64 but the character fills only ~20 rows of them, so
    anything that assumes the frame edges are the head and feet (labels, depth
    sorting, where a hero stands) is off by tens of pixels."""
    top, bottom = FRAME_H, 0
    for name in BODY_ANIMS:
        row = rows[name]
        for f in range(frames[name]):
            box = (f * FRAME_W, row * FRAME_H, (f + 1) * FRAME_W, (row + 1) * FRAME_H)
            bbox = sheet.crop(box).getchannel("A").getbbox()
            if bbox is None:
                continue
            top = min(top, bbox[1])
            bottom = max(bottom, bbox[3])
    if bottom <= top:
        raise AssertionError("no opaque pixels in the body rows")
    return top, bottom


def _anim_extent(sheet: Image.Image, anims: dict[str, dict[str, int]]) -> tuple[int, int]:
    return _body_extent(
        sheet,
        {n: a["row"] for n, a in anims.items()},
        {n: a["frames"] for n, a in anims.items()},
    )


def bake_heroes(src: Sources, out_dir: Path) -> dict:
    """Returns the sheet metadata destined for the generated TS file."""
    base_strips = {a[0]: _strip(src, "base", a) for a in ANIMS}
    tools_strips = {a[0]: _strip(src, "tools", a) for a in ANIMS if a[4]}
    _assert_shirt_present(base_strips["idle"])

    hair_strips: dict[str, dict[str, Image.Image]] = {
        hair: {a[0]: _strip(src, hair, a) for a in ANIMS}
        for hair in set(CLASS_HAIR.values())
    }

    anim_table = {name: {"row": row, "frames": frames} for row, (name, _, _, frames, _) in enumerate(ANIMS)}
    head, foot = FRAME_H, 0
    for klass, hair in CLASS_HAIR.items():
        for color, ramp in SHIRT_RAMPS.items():
            sheet = Image.new("RGBA", (FRAME_W * COLUMNS, FRAME_H * len(ANIMS)))
            for row, (name, _, _, frames, needs_tools) in enumerate(ANIMS):
                base = _swap_ramp(base_strips[name], SHIRT_SOURCE, ramp)
                hair_layer = _swap_ramp(hair_strips[hair][name], HAIR_SOURCE[hair], ramp)
                for f in range(frames):
                    sx = f * FRAME_W
                    frame = base.crop((sx, 0, sx + FRAME_W, FRAME_H))
                    paste(frame, hair_layer.crop((sx, 0, sx + FRAME_W, FRAME_H)), 0, 0)
                    if needs_tools:
                        paste(frame, tools_strips[name].crop((sx, 0, sx + FRAME_W, FRAME_H)), 0, 0)
                    paste(sheet, frame, f * FRAME_W, row * FRAME_H)
            save_png(sheet, out_dir / "heroes" / f"{klass}-{color}.png")
            # One extent for every class: the tallest hairstyle sets the head,
            # so a label hung above it clears all of them.
            sheet_head, sheet_foot = _anim_extent(sheet, anim_table)
            head, foot = min(head, sheet_head), max(foot, sheet_foot)

            # Portrait: idle frame 0, content-cropped then padded to a square
            # canvas (HeroAvatar stretches to its box), x4 for crisp CSS.
            portrait_src = sheet.crop((0, FRAME_H, FRAME_W, FRAME_H * 2))
            save_png(
                upscale(_square_portrait(portrait_src), 4),
                out_dir / "heroes" / f"portrait-{klass}-{color}.png",
            )

    return {
        "frameWidth": FRAME_W,
        "frameHeight": FRAME_H,
        "columns": COLUMNS,
        "anims": anim_table,
        "classes": list(CLASS_HAIR),
        "colors": list(SHIRT_RAMPS),
        "headY": head,
        "footY": foot,
    }


SKELETON_ANIM_FILES = {
    "walk": "skeleton_walk_strip8.png",
    "idle": "skeleton_idle_strip6.png",
    "attack": "skeleton_attack_strip7.png",
}


def bake_skeleton(src: Sources, out_dir: Path) -> dict:
    """Skeleton sheet for the arena's sparring partner — an NPC, not a hero,
    so it only needs the rows the arena plays (idle, attack, walk). Frames
    share the 96x64 hero geometry; counts are measured from strip width."""
    strips = {
        name: src.image(f"Characters/Skeleton/PNG/{path}")
        for name, path in SKELETON_ANIM_FILES.items()
    }
    for name, img in strips.items():
        if img.height != FRAME_H or img.width % FRAME_W != 0:
            raise AssertionError(f"skeleton {name}: unexpected strip size {img.size}")
    columns = max(img.width // FRAME_W for img in strips.values())
    sheet = Image.new("RGBA", (FRAME_W * columns, FRAME_H * len(strips)))
    anims: dict[str, dict[str, int]] = {}
    for row, (name, img) in enumerate(strips.items()):
        anims[name] = {"row": row, "frames": img.width // FRAME_W}
        paste(sheet, img, 0, row * FRAME_H)
    save_png(sheet, out_dir / "heroes" / "skeleton.png")
    head, foot = _anim_extent(sheet, anims)
    return {
        "frameWidth": FRAME_W,
        "frameHeight": FRAME_H,
        "columns": columns,
        "anims": anims,
        "headY": head,
        "footY": foot,
    }


def bake_goblins(src: Sources, out_dir: Path) -> dict:
    """Goblin sheet for Codex-sourced agents — same grid as the human sheets.

    Goblins are not layered (single strips, own outfit) so there is one sheet,
    not a colour matrix. Some goblin strips have different frame counts than
    the human ones (the filenames lie — e.g. spr_idle_strip9.png holds 8
    frames), so the actual counts are measured and returned.
    """
    sheet = Image.new("RGBA", (FRAME_W * COLUMNS, FRAME_H * len(ANIMS)))
    anims: dict[str, dict[str, int]] = {}
    for row, (name, _, _, _, _) in enumerate(ANIMS):
        img = src.image(f"Characters/Goblin/PNG/{GOBLIN_ANIM_FILES[name]}")
        if img.height != FRAME_H or img.width % FRAME_W != 0:
            # A few goblin strips use a different frame geometry (e.g. the
            # 96x192 hammering strip). Skip those — the theme falls back to
            # idle for animations missing from this table.
            continue
        frames = img.width // FRAME_W
        if frames > COLUMNS:
            raise AssertionError(f"goblin {name}: {frames} frames exceeds grid")
        anims[name] = {"row": row, "frames": frames}
        paste(sheet, img, 0, row * FRAME_H)
    save_png(sheet, out_dir / "heroes" / "goblin.png")

    portrait_src = sheet.crop((0, FRAME_H, FRAME_W, FRAME_H * 2))
    save_png(upscale(_square_portrait(portrait_src), 4), out_dir / "heroes" / "portrait-goblin.png")
    head, foot = _anim_extent(sheet, anims)
    return {"anims": anims, "headY": head, "footY": foot}
