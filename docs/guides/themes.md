# Asset Themes

Agent Quest renders the world from a **theme** — a manifest
(`client/src/game/themes/types.ts` → `ThemeManifest`) that tells Phaser which
PNGs to preload and how to animate them. The active theme is registered in
`client/src/game/themes/registry.ts`; there is no runtime switching.

## Active theme: `sunnyside`

| Id | Display name | Source pack | Licence | Location |
|---|---|---|---|---|
| `sunnyside` | Sunnyside World | [Sunnyside World](https://danieldiggle.itch.io/sunnyside) by Daniel Diggle | Paid; use in projects permitted, raw-asset redistribution not | `client/public/assets/themes/sunnyside/` |

The committed assets are **baked derivatives**, not the pack: composited hero
sheets, assembled buildings, re-laid tilesets. They are produced by
`scripts/bake-sunnyside/` (Python + Pillow) from the purchased pack zips and
committed, so cloning the repo needs no setup. See
`client/public/assets/themes/sunnyside/README.md` for the full inventory and
re-bake instructions, and the "Art pipeline" section of `CLAUDE.md` for the
design decisions.

## The manifest surface

- `getHeroPreload()` / `getHeroConfig(color, unit, source?)` /
  `getHeroPreview(color, unit, source?)` — hero sheets, animation frame
  indices (including `extraAnims` for activity-matched stationary
  animations), and the React avatar portraits. `source === 'codex'` returns
  the goblin.
- `terrain` — grass tileset + the road sheet contract (6 columns: a 4×4
  16-edge-tile block, gravel accent, tuft accent) consumed by
  `PathTileRenderer` and pinned by `path-tiles.test.ts`.
- `getBuildingImage(id)` / `getBuildingScale(id)` — the 8 activity buildings;
  scale is derived from measured doorway heights so a doorway renders at one
  size everywhere (`sunnyside.test.ts` pins it).
- `getStaticAssetPreload()` — scenery (static images and animated
  spritesheets), VFX.
- `getChimneyAnchor(id)` — where smoke rises from an occupied building.
- `postLoadHook(scene)` — registers looping animations for animated scenery
  and the chimney smoke.

The generated `client/src/game/themes/sunnyside-sheet.ts` carries every frame
count, row index, door height and chimney anchor the manifest needs — it is
emitted by the bake and must never be edited by hand.

## Adding a new theme

1. Bake (or collect) assets into `client/public/assets/themes/<id>/`,
   matching the shapes above — in particular the road sheet's 6-column
   contract and per-kind scenery keys (`tree-1…`, `bush-1…`, `rock-1…`,
   `mushroom-1…`, `flower-1…`, `stump-1…`, `animal-1…`).
2. Write the manifest in `client/src/game/themes/<id>.ts`, widen `ThemeId`
   (also in `server/src/map/asset-manifest.ts`), register it, and set
   `rebaseSavedScale` so `village.json`'s stored `heroScale` (authored
   against the original Tiny Swords baseline) renders at the right size.
3. Provide a server manifest (`server/src/map/asset-manifest-<id>.ts`) whose
   tileset keys match what `server/data/map/village.json` references — or
   migrate the map's texture keys/frames with a one-off script (the
   Sunnyside swap did this, then deleted the script so it could never be
   re-run over later hand edits).
4. `bun run check:assets`, `bun test`, and eyeball the running app.
