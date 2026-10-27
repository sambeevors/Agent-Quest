# Sunnyside World — processed assets

Everything in this directory is **generated** by `scripts/bake-sunnyside/`
from the purchased [Sunnyside World](https://danieldiggle.itch.io/sunnyside)
asset pack by **Daniel Diggle**. Nothing here is the pack as shipped:

- `heroes/` — composited spritesheets (base + hairstyle + tools layers merged
  per frame), with the shirt and hair palette-swapped per hero colour. One
  sheet per (class, colour), one row per animation, 23 columns, 96×64 frames.
  `portrait-*.png` are content-cropped idle frames for the React avatars.
  `goblin.png` is the Codex-session character; `skeleton.png` is the
  arena's sparring NPC.
- `buildings/` — the 8 activity buildings,
  assembled from the pack's modular building sheet, tileset pieces and deco
  sprites at one consistent zoom (×4), roofs recoloured per building. The
  arena and farm are fenced enclosures with a separate `-ground.png` floor
  layer (drawn under the heroes standing inside them).
- `terrain/` — tilesets re-laid to the shapes the renderers expect: the road
  sheet's 6-column/16-edge-tile contract, grass variants, water, the meadow
  base mix, the bridge deck.
- `scenery/` — trees, bushes, rocks, mushrooms, flowers, stumps
  and farm animals, upscaled ×4 nearest-neighbour. Only the animals are
  animated strips; foliage is baked static.
- `vfx/` — chimney smoke and glint strips.
- `../../ui/sunnyside/` — the 9-slice panel boxes, label plate and icons for
  the React overlay, kept at native 1× (CSS scales them).

Frame counts, animation rows, door heights and chimney anchors are recorded in
`bake-meta.json` and mirrored in the generated
`client/src/game/themes/sunnyside-sheet.ts`.

## Licence

Sunnyside World is a **paid** pack. Its licence permits use in games and
projects but **not redistribution of the assets themselves**. This directory
contains only processed, project-specific derivatives needed at runtime; the
original pack (layered strips, PSDs, GameMaker project, full tileset) is not
included. If you fork this project and keep the art, please buy the pack.

## Re-baking

The bake reads the pack zips directly (they are not committed):

```bash
python3 scripts/bake-sunnyside/bake.py --pack <Sunnyside_World_ASSET_PACK_V2.1.zip> \
                                       --archived <Sunnyside_World_ARCHIVED_ASSETS.zip>
```

Requires Python 3 + Pillow. Deterministic — same zips in, same PNGs out.
