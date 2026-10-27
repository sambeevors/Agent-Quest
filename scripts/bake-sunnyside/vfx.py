"""Bake VFX strips: chimney smoke (played on occupied buildings) and glint."""

from __future__ import annotations

from pathlib import Path

from common import Sources, save_png, upscale


STRIPS = {
    "chimneysmoke": ("Elements/VFX/Chimney Smoke/chimneysmoke_01_strip30.png", 15, 37),
    "glint": ("Elements/VFX/Glint/spr_deco_glint_01_strip6.png", None, None),
}


def bake_vfx(src: Sources, out_dir: Path) -> dict:
    meta: dict = {}
    for name, (path, fw, fh) in STRIPS.items():
        strip = src.image(path)
        if fw is None:
            # square frames inferred from height
            fh = strip.height
            fw = strip.height if strip.width % strip.height == 0 else strip.width // 6
        if strip.width % fw != 0:
            raise AssertionError(f"{name}: {strip.size} not divisible by frame {fw}")
        save_png(upscale(strip), out_dir / "vfx" / f"{name}.png")
        meta[name] = {
            "frames": strip.width // fw,
            "frameWidth": fw * 4,
            "frameHeight": fh * 4,
        }
    return meta
