# Hand-drawn building art

Sprites in this directory are **drawn for this repo**, not derived from the Sunnyside World
pack. They are bake *input*: a recipe in `../buildings.py` opens the PNG and pastes it through
unchanged, and the bake still owns the ×4 upscale and all the metadata. That is why they live
here and not in `client/public/assets/themes/sunnyside/`, which is bake output and is documented
as generated.

Because they are original work they are safe to commit, unlike the pack itself.

| File | Building | Canvas | Door height | Chimney anchor | Roof |
|---|---|---|---|---|---|
| `library.png` | Library | 92×64 | 16 | `(46, 1)` — flue on the nave ridge | blue |
| `castle.png` | Castle | 92×61 | 13 | `(46, 24)` — the middle crenel | blue |
| `watchtower.png` | Watchtower | 36×96 | 12 | `(18, 2)` — the beacon at the apex | blue |
| `tavern.png` | Tavern | 72×56 | 13 | `(36, 2)` — the stack mouth | orange |
| `forge.png` | Forge | 72×54 | 13 | `(36, 1)` — the brick flue mouth | red |
| `alchemist.png` | Alchemist | 44×68 | 12 | `(22, 1)` — the tapered flue mouth | green |

Door heights are **duplicated** in `server/src/map/asset-manifest-sunnyside.ts` and nothing tests that
the two agree — change one and you must change the other, or the client and server will scale the
same building differently.

Roof colour is the map's legend: each building's glass is tinted to match its roof, so they are told
apart by colour before shape. Don't reassign one without checking it stays distinct from its
neighbours.

`library.png` is the **reference sprite**: it is the one that went through review to sign-off, and
anything drawn later should be checked against it. What it settles:

- Identity is one bold icon (an open book over the door), not a detailed vignette — detail becomes
  noise at the ~0.47 render scale.
- Wall windows are empty `#201C2C` voids matching the door, not glazed.
- Roof slopes are **mirrored about the centre**, bright edge outward on each side, with a flat
  glazed panel carrying no shingles in the middle span. The horizontal trim under that panel is its
  sill and only makes sense with the panel present.
- Chimneys are stone.
- Restraint: the approved version has *fewer* elements than the drafts it replaced, and measures
  1.65% full-pixel asymmetry against the pack library's 4.7%.

## Rules a sprite here must meet

The bake will happily paste through art that breaks these; the village is what notices.
`.claude/skills/pixel-art-creator/references/art-style.md` has the measurements behind each one.

- **Draw at native 16px scale, never pre-upscaled.** Everything on the canvas is ×4 of one 16px
  grid, and the bake does that multiplication. A sprite drawn at 64px carries detail finer than
  every neighbour and reads as a different game.
- **Transparent background, no grass baseline.** The ground under a building is the world's meadow.
- **The bottom row is the ground line**, and the door opens onto it. Buildings are anchored
  bottom-centre and y-sort on that row.
- **Front-on, tilted down ~25°.** No side walls, no skew, vertical edges vertical — but horizontal
  surfaces open up, so ledges show their tops and you see down into openings.
- **Lit from directly overhead, with no left-right bias.** Measured across the baked buildings, the
  left and right halves differ in mean luminance by ~0. Highlight on top, shadow underneath,
  nothing on either flank. Round forms turn via *symmetric* rim darkening (`dark → light → dark`
  across every row), not a directional gradient.
- **Outline each shape in its own darkest ramp step, not a shared black.** The baked buildings
  outline timber in `#733E39` and roofs in `#124E89`; stone uses `#5A6988`.
- **Three-step ramps.** A fourth step at this scale reads as mud.
- **Alpha is 0 or 255.** The baked buildings carry no partial alpha and no contact shadow.
- **Colours from `.claude/skills/pixel-art-creator/references/sunnyside.gpl`**, or justified against
  the baked art. White is for window glints only, and sparingly.
- **Declare the doorway**, not the footprint. `getBuildingScale` normalises every building so its
  door renders at one size (`REFERENCE_DOOR = 52` baked px), so the door height returned by the
  recipe is the only size that matters — a bigger canvas just makes a bigger building around it.

`castle.png` is drawn as a left half and mirrored, which is why it measures 0.00% asymmetric; the
pack's own castle and watchtower come in at 1.0% and 0.1%.
