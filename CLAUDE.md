# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Agent Quest is a browser-based monitoring dashboard that visualizes active Claude Code and Codex agent sessions as fantasy heroes in a 2D WoW-style village. Each agent is represented as a hero character that walks between buildings corresponding to its current activity (Read → Library, Edit → Forge, Bash → Arena, etc.).

This repository is a fork of [FulAppiOS/Agent-Quest](https://github.com/FulAppiOS/Agent-Quest). Beyond upstream it adds cost tracking, generated roads/scenery, and a full art replacement (Sunnyside World) — see "Fork additions", "Generated map layers" and "Art pipeline" below.

## Architecture

Two-process monorepo:

- **server/** — Bun + Hono backend. Two providers run in parallel: `ClaudeProvider` auto-discovers every `~/.claude*` directory with a `projects/` subdir (e.g. `~/.claude`, `~/.claude-work`, `~/.claude-personale`); `CodexProvider` watches `~/.codex/sessions/` for Codex rollout files. Both poll their session logs every 2-3s, parse events into `AgentState` objects, push updates over native Bun WebSocket. Each `AgentState` carries its `configDir` and a `source` field (`'claude' | 'codex'`) so the UI can distinguish installations and providers. Optional Hono endpoint receives Claude Code `postToolUse` hooks for lower-latency events — **Claude Code only**; Codex doesn't expose hooks. `SessionRegistry` (pidfile oracle) is also **Claude-only by design**; Codex liveness is inferred purely from rollout-file activity.
- **client/** — React 19 + Phaser 4 "Caladan" frontend. The world is a single read-only map (`server/data/map/village.json`) served by `GET /api/map`; there is no map editor. Fullscreen Phaser canvas renders the village; React overlay panels (Party Bar, Activity Feed, Detail Panel, Minimap, Top Bar) sit on top via ref-based bridge pattern (useRef + useEffect + EventEmitter).

- **desktop/** — Electron shell (macOS). `src/main.ts` spawns the server as a child process (Bun can't run inside Electron's Node: packaged it is a `bun build --compile` binary, from source it is `bun run`) and points it at the built client via `AGENT_QUEST_CLIENT_DIR`, so the window loads everything from :4444 (`server/src/static/client-routes.ts`). `AGENT_QUEST_MAP_PATH` relocates the map, because a compiled binary's `import.meta.dir` is a virtual path. The server exits when its stdin closes (`AGENT_QUEST_EXIT_WITH_PARENT`), so a crashed shell doesn't strand :4444. Open-at-login is enabled once on first run of the installed app and is the user's after that.

Data flow: `~/.claude*/projects/**/*.jsonl` and `~/.codex/sessions/**/rollout-*.jsonl` → ClaudeProvider / CodexProvider → SessionParser (per-format) → AgentStateManager → WebSocket → Browser (React state + Phaser scene).

## Fork additions

Features this fork adds on top of upstream. Each is isolated in its own module with unit tests.

| Feature | Server | Client |
|---|---|---|
| Cost tracking | `server/src/pricing/model-pricing.ts` — family-keyed USD rates; `AgentStateManager.addUsage` prices each deduped record against the model that produced it | `formatCost`/`isCostKnown` in `types/agent.ts`; shown in TopBar, DetailPanel, SessionReport |
| Hero names | — | `naming/hero-names.ts` — `heroNameFor(agentId)`; the only label on the canvas, and the primary one in every panel |
| Hero chatter | — | `game/data/hero-chatter.ts` (lines + timing) drawn by `game/entities/ThoughtBubble.ts`; scheduled per hero in `HeroSprite` |
| Sunnyside art | `server/src/map/asset-manifest-sunnyside.ts` | `game/themes/sunnyside.ts` + generated `sunnyside-sheet.ts`; baked assets under `client/public/assets/themes/sunnyside/`; bake pipeline in `scripts/bake-sunnyside/` |

Notes for anyone extending these:

- **Cost is an estimate at public list prices**, never a bill. `costKnown: false` means an unpriced model contributed and the figure is a lower bound — keep the `≥` marker in any new surface that shows it.
- **A hero's name is derived from its agent id, never stored.** `AgentState.name` still carries the session's real identity (slug, project folder, or subagent descriptor) and the Detail Panel shows it under the class; the fantasy name shown everywhere else is `heroNameFor(agent.id)`. Deriving it keeps a hero's name stable across reloads and server restarts — unlike `heroClass`/`heroColor`, which are round-robin counters in `AgentStateManager` and reshuffle on restart — and lets the Activity Feed name an agent it no longer tracks. The name-picking hash needs its avalanche step: session ids differ only in their tail, and without mixing the two table indices correlate badly (`hero-names.test.ts` pins the spread).
- **The canvas carries the hero's name and nothing else.** Activity, model badge, current file and current prompt used to stack under every sprite, four rows deep, and the village read as a log file with trees. That detail all lives in the React panels (Party Bar, Activity Feed, Detail Panel), so the sprite says what the hero is *thinking* instead: a thought bubble every 14–36s, drawn from the pool for whatever it is doing, plus one on a fresh error. **A hero on the road holds its tongue** — the activity flips at dispatch, so a line said mid-walk would ring an anvil the hero is still half a village away from; the timer marks the thought pending and it lands on arrival, in the register of the building the hero is actually standing at. Error lines are the exception, as they always were: they are building-agnostic and fire on sight, walking or not. Two things the lines must keep — they speak in the register of the **building** the activity sends the hero to (the Forge hammers, the Alchemist brews) rather than naming the tool that got them there, and nothing in them is derived from session state, so a bubble can never go stale or leak a path into a screenshot. `hero-chatter.test.ts` pins both. The gold `waiting…` label went with the rest of the stack; a waiting hero now pulses its *name*'s alpha, which is the one status you need to spot from across the map. **The name sorts in a band of its own** (`HERO_LABEL_DEPTH` in `game/text.ts`), above every y-sorted sprite: everything else on the canvas sorts on its world y, and a hero stationed inside the arena or the farm stands well above that enclosure's door line — so in the y-sorted band the fence outranks the hero's label and its top rail cuts the name in half. The sprite itself stays y-sorted; only the labels and the bubble are lifted, ordered among themselves by foot y so a near hero's name still covers a far one's.

## Generated map layers

Roads and scenery are **generated at runtime**, not read from the shipped map. All are pure modules with unit tests, and all key off the buildings that actually spawned — so they stay correct when a building moves.

| Layer | Modules | Renderer |
|---|---|---|
| Roads (desire paths) | `game/data/desire-paths.ts` (routing) + `game/data/path-tiles.ts` (tiling) | `game/terrain/PathTileRenderer.ts` |
| Scenery (trees/bushes/rocks/mushrooms/flowers) | `game/data/scenery.ts` | `game/terrain/SceneryRenderer.ts` |
| Shoreline (River-autotile fringe + 45° cut corners) | `game/data/shore.ts` — derived from the terrain grid's water cells | `game/terrain/MapConfigRenderer.ts` |
| Critters (meadow animals + lake ducks) | placed by `game/data/scenery.ts` (`animal` kind) and per water rect | `game/entities/Critter.ts` — wandering sprites; ducks bounded to their water |

`VillageScene.rebuildRoads()` drives both, once the world boots.

What the shipped `MapConfig` contributes: terrain tiles, building positions, spawn point, settings, and **placed features** (the lake's rocks and its bridge). It carries no roads and no natural scatter — both are generated.

**Nothing stands in the village that doesn't mean something.** Every building on the map is one of the 8 activity buildings; everything else is landscape. The map used to also carry a knight's tower, three gold mines, wood piles, a stray fire and explosion, and 51 wandering villagers around a purple hamlet — all removed, because a reader who can't tell decoration from signal has to check each one before trusting any of them. Foliage is exempt: it reads as ground, not as state — and with the Sunnyside art that exemption deliberately covers the whole cozy-farm layer (flowers, mushrooms, grazing animals), which is scattered by the same seeded generator as the trees. Everything botanical is baked **static** (plants that dance in a world with no wind read as noise); only creatures move — animals *wander* (`Critter.ts`), with seeded placement and free motion, like smoke. Stray crop patches used to scatter here too, but squares of farmland in the wild read as meaning something, so cultivation now lives only inside the Farm. Two pieces of ambience ARE signal, on the same contract: **chimney smoke rises from a building only while a hero is stationed inside** (`Building.setSmoking`), and **the arena's resident goblin and skeleton spar only while a hero is in the yard** (`ArenaFighters.setFighting`) — both driven from `VillageScene.refreshOccupancy`. That reads the `arrived` set, **not** the slot assignment: a hero's slot flips the instant its activity does, while the hero itself is still a second or two of walking away, and a forge that smokes for a hero crossing the meadow is telling you something that isn't true yet. `HeroSprite.moveTo` takes an `onArrive` callback (synchronous if the hero is already on its spot) which raises occupancy; the sweep at the end of `handleAgentUpdate` is what lowers it, since a hero that walked off or vanished fires no arrival for the building it left. Only the six roofed buildings have a chimney anchor — the arena and farm are fences, and `sunnyside.test.ts` pins that they have none; the arena's tell is its fighters instead, and the farm has none.

Arrival also decides which way a parked hero looks (`stationFocusX`): a hero that simply stops walking keeps whatever direction its last road segment pointed, which regularly leaves it with its back to the anvil it is hammering. Arena heroes turn to the fighters' real mean x (`ArenaFighters.focusX`), everyone else to the door they are working at, and the farm to nothing — its waterers stand among crop rows that surround them, so there is no focal point to name.

Roads are **tiled from the pack's own dirt tiles**, not painted over the grass, so a track meets the meadow with the artist's own wavy fringe rather than a procedural edge that never quite matches. The tileset has no orthogonal 16-tile edge set, so the bake synthesises one — plain-earth fill plus the fringe strip mirrored/transposed per side — into the exact 6-column sheet the renderer expects (`scripts/bake-sunnyside/terrain.py`; the contract is pinned by `path-tiles.test.ts`).

**Sprite size comes from the artwork, and the unit is the doorway — not the file.** `SCENERY_SCALE` covers every scenery kind, so a tree frame and a mushroom frame render at the proportions they were drawn. The whole pack is baked from one 16px grid at ×4, which is what makes a single scale sufficient.

Buildings are assembled by the bake at that same zoom, so their doorways come out consistent **by construction** — where they differ (`library 64 · forge/tavern/castle 52 · alchemist/watchtower 48 · arena/farm 72`, in baked px) it is by design: a castle gate is taller than a hut door, and the enclosures' "door" is the gate gap in their fence, declared tall so the fence renders around hero height instead of towering over it. `DOOR_HEIGHT` (from the generated `sunnyside-sheet.ts`) and `getBuildingScale` still normalise the *rendered* doorway to one size, because door-to-hero proportion is the thing the eye checks; `sunnyside.test.ts` pins the invariant.

Heroes sit on a third scale again (`MapConfig.settings.heroScale`, stored against the original Tiny Swords baseline and rebased ×4 in `registry.ts`) — a known inconsistency, not a licence to add more.

Invariants worth preserving:

- **No drawn road may touch a building.** The routing graph heroes walk IS the road network, so this is also what stops heroes clipping. The keep-out is the building's **whole sprite rect** (`building-plan.ts` `spriteRect`, used by `Building.footprint`), not a ground band: the halls' walls run 81–100% of the image width down to the ground, and since roads draw beneath every sprite, a track allowed behind the upper storey shows as dirt poking past the eaves and over the roof (`sunnyside.test.ts` pins that each baked building fills its image). Clearance is measured from what is **drawn**, not the centreline: `roadClearance` = the rasteriser's reach (`drawnRoadReach`) + the post-routing wobble + 2px. Each door meets the network on a straight lead due south (`doorLead`), so the only dirt under a sprite is its doorstep (`doorApproach`); the jetty gate works the same way (`gateNode`). Three subtleties have already bitten here, all covered by regression tests in `desire-paths.test.ts`: a door sits inside its own building's clearance ring, so routes collide against that building's bare rect rather than dropping it from the route entirely; the organic wobble applied after routing is validated per *segment*, since a point just outside a corner can still be reached by a line through it; and `segmentHitsRect` must catch a corner-to-corner diagonal through a rect. `village-layout.test.ts` checks all of this on the shipped map.
- **Buildings stand clear of each other.** Positions in `village.json` keep ≥ 48px between sprite rects (more where a road runs between), have x on the 32px road grid so each door's track arrives centred, and leave forecourt room for a 3×3 crowd in front of every door. `village-layout.test.ts` pins it — move a building and that test says whether it still fits.
- **Nothing spawns on a road, against a wall, in the water, or over other scenery.** Every check is against what is drawn: the item's sprite rect (`sceneryFootprint`, art size × jittered scale) must keep a per-kind gap from the road *tiles* `buildPathTilemap` produced, from building sprite rects, and from exclusions. Scenery must not overlap scenery of **any** kind (`sceneryClear`, `SCENERY_GAP`): the one exception is tree crowns, which may interlock side by side so long as neither sprite reaches the other's trunk band (`treeBase`) — full non-overlap thinned the woods to an orchard. Stumps, bushes, rocks, mushrooms and flowers are never covered, and animals never spawn inside a sprite. Per-kind gaps live in `KIND_SPECS`; trees need far more room than mushrooms. Water is the awkward one: the lake is 204 cells of `terrain-water` in the terrain grid, not a placed feature, and every one of them is flagged `walkable: true` — so `game/data/water.ts` derives the keep-out rects from the tiles themselves rather than trusting the map to describe them.
- **Both generators are seeded and deterministic.** Scenery that reshuffles every reload is disorienting, and a road that moves under a walking hero is a bug.
- **Don't close concave corners in the road grid.** A 16-tile edge set has no inner-corner tile, and filling the notch looks like the fix — but iterating that rule is a morphological closing: it eats the grass out of every space the network encloses and turns the village into one plaza. `makeTileable` fills only pinholes and diagonal-only touches, and `path-tiles.test.ts` guards a ring of roads around an open green.

## Art pipeline (Sunnyside World)

All artwork is [Sunnyside World](https://danieldiggle.itch.io/sunnyside) by Daniel Diggle — a **paid, non-redistributable** pack. The repo commits only **baked derivatives** under `client/public/assets/themes/sunnyside/` (+ `client/public/assets/ui/sunnyside/`), produced by `scripts/bake-sunnyside/` (Python + Pillow) reading the pack zips directly. Re-baking needs the zips; the baked PNGs and the generated metadata (`client/src/game/themes/sunnyside-sheet.ts`, `bake-meta.json`) are committed so nobody else ever runs the bake.

What the bake does, and why it exists at all:

- **Heroes** — the pack ships layered strips (base + 6 hairstyles + tools). The bake composites them per frame into one grid sheet per (class, colour): rows are animations, 96×64 frames, 23 columns. Class = hairstyle silhouette (warrior spikey, archer long, pawn bowl); **colour = shirt AND hair palette-swap** — at portrait size the hair is the only feature big enough to carry colour identity. Codex sessions get the goblin sheet (`getHeroConfig(color, unit, source)`); square content-cropped portraits feed the React avatars.
- **Activity animations** — `HeroSpriteConfig.extraAnims` maps agent states to sheet rows: editing→hammering, bash→attack, debugging/git→doing, waiting→foot-tap. Everything else idles. A parked hero plays its state's animation (`HeroSprite.playStationary`); 'waiting' outranks the activity.
- **Buildings** — the pack has **no prefab buildings**, only a modular sheet plus tileset wall/roof pieces in 5 roof colours. **The six roofed halls are hand-drawn** (`scripts/bake-sunnyside/art/*.png`, pasted through by the `drawn(name, door_height, chimney)` factory in `buildings.py`); only the two fenced enclosures are still assembled from pack pieces. Assembly was tried first for all of them and lost: the parts only ever composed into rows of huts wearing hats, the castle's "towers" were the tileset's monument *pedestals*, and each building's identity ended up as a prop dumped on the grass beside the door rather than built into the facade. Drawn art obeys every rule assembly got for free — one 16px grid (100% of 4×4 blocks in the baked PNGs are uniform), ×4 on the way out, doorway declared to the shared normaliser — so nothing downstream can tell the difference, and `drawn()` keeps each one a single line. Roof colour is the map's legend and is per-building: blue Library/Watchtower/Castle, orange Tavern, red Forge, green Alchemist, with **window glass tinted to match the roof**, so the six are told apart by colour before shape. See `scripts/bake-sunnyside/art/README.md` for the rules any further hand-drawn building must meet — the load-bearing ones are overhead light with **no left-right bias** (the baked buildings measure ~0 difference between their halves), a mirror-symmetric silhouette, three form steps plus a *separate* deeper tone for outlines and fine edges, and alpha that is only ever 0 or 255. Two are **enclosures heroes physically enter** — the Arena (bash: a fenced sparring yard where the hero fights the resident goblin and skeleton) and the Farm (git: fenced crop rows the hero waters) — each baked as a fence-ring structure PLUS a `-ground` floor layer, because a floor baked into the structure would sit at door depth and paint over any hero standing inside; `Building` draws the floor beneath the y-sorted world and `VillageScene.calcInteriorPositions` stations heroes inside the bake-declared `interior` rect. The farm goes further: the bake also exports the **centre of every tilled bed** (`buildings.crops`, from the same constants that paint them, so the two can't drift), and `FarmWork` owns that building's positions outright — a hero walks in to a bed, waters it for 4.5–11s, then crosses to another free one. Bed-to-bed hops use `HeroSprite.walkDirect`, since routing a step between two beds through the road graph marches the hero out of the gate and back. Unlike the scenery and road generators, the choice is **not** seeded: this is creature motion, like `Critter`'s wandering, and predictability is the opposite of the point. Roof recolouring maps the sheet's blue shingle ramp to the tileset's other colour ramps, and tints the window glass to match — the pack's own colour blocks do the same.
- **Terrain** — 16px tiles upscaled ×4 to the 64px world grid, so `village.json` geometry survived the swap untouched (a one-off migration rewrote its keys/frames; it was deleted afterwards, since re-running it on the current map would wipe the lake's stones and jetty — `village.json` is now edited directly). One coherent pixel-density story: everything on the canvas is ×4 of the same 16px grid except hero frames (kept native, scaled 1.6).
- **UI kit** — 9-slice boxes/label plate at native 1× for CSS `border-image` (`client/src/sunnyside-ui.css` reskins panel chrome only; layout, text palette and RuneScape type unchanged).

If a sprite looks wrong, fix the **recipe** and re-bake — never edit a baked PNG by hand. Coordinates of every tile the bake pulls from the 16px tileset are named constants in the bake modules.

## Typography

Everything the user reads — React panels and Phaser's in-world labels alike — is set in RuneScape (`client/public/assets/fonts/runescape.ttf`, declared in `client/src/fonts.css`).

Two things about that file drive the setup. Its glyph bounds and advance widths are all multiples of 1/16 em, so it was drawn for 16px and has no other native size; and its lowercase is small for its em (x-height 0.375, cap 0.625), so it reads a third smaller than the Fira Code and Cinzel it replaced at the same declared size. Hence **two faces off the one file**:

- `RuneScape UI` carries `size-adjust: 145.45%` and is what `--font-ui` / `--font-display` resolve to. 145.45% is 16/11, and 11px is the commonest size in these panels, so most of the UI lands on the font's native size without re-tuning ~140 `font-size` rules and the widths fitted to them. It is also the factor that matches x-height with Fira Code, which is why the fallbacks after it are unadjusted: they supply the glyphs RuneScape lacks (arrows, `≥`, `✓`) at the same optical size as the text around them.
- `RuneScape` keeps the file's own metrics and is what Phaser uses via `LABEL_FONT` in `game/text.ts`. In-world sizes are chosen per call site, and they were stepped up ~15% when the font changed to hold the size each label was tuned to.

Two consequences to keep in mind:

- **The app mounts behind the font.** Phaser bakes each label into a canvas texture once and never re-renders it, so a label drawn before the font arrived would keep the fallback for the life of the scene. `main.tsx` awaits both faces (2s cap) before `createRoot`.
- **Boot-screen paths and shell commands stay monospace.** They exist to be read character by character and pasted into a terminal, which a proportional pixel face with no case-distinct 0/O makes needlessly hard.

## Commands

```bash
bun start              # Start both server and client (concurrently)
bun run dev:server     # Server only on localhost:4444
bun run dev:client     # Client only on localhost:4445
bun run check:assets   # Verify every bundled sprite referenced by the theme exists on disk
bun run desktop        # Electron shell from source (builds the client first)
bun run desktop:install # Package Agent Quest.app and install it to /Applications
```

## Ports

| Service | Port |
|---|---|
| Server (WebSocket + HTTP API) | `localhost:4444` |
| Client (Vite dev server) | `localhost:4445` |

These are fixed. Do NOT use 3000, 3333, 5173, 5174, 8000 — reserved by other projects.

## Code Conventions

- TypeScript strict everywhere, no `any`
- Code and identifiers in English, UI labels in English
- Commit messages: conventional style (`feat:`, `fix:`, `refactor:`)

## Git Workflow

- **Never push to the remote automatically.** The repo is public on GitHub; every `git push` must be explicitly requested by the user. Commits are fine without asking (once changes are ready), but pushes require direct authorization.

## Key Type: AgentState

The central data model flows from server to client. Defined in shared types. Maps tool calls to activities: Read/Grep/Glob → `reading`, Edit/Write → `editing`, Bash → `bash`, thinking → `thinking`, git → `git`, idle → `idle`, debug → `debugging`, review → `reviewing`.

**A Bash call is classified by what it actually runs**, not by the tool name — agents do much of their reading and searching through the shell (`grep -rn`, `cat`, `sed -n`, `find`), and sending all of it to the Arena left the Library empty. `classifyBashCommand` in `server/src/parsers/bash-activity.ts` is the single owner of that decision and both parsers call it (Codex prefers its own `parsed_cmd` when present and falls back to the classifier). It is deliberately conservative: a command reads only when *every* pipeline segment is a read or a neutral chore (`cd`, `echo`) and nothing redirects into a file — so `grep x src | head` reads, while `grep x src > out.txt`, `cat urls | xargs curl`, and `find … -exec rm` stay generic shell work. Publishing outranks reading: a write-oriented `git` (`commit`, `push`, `merge`, `rebase`, `cherry-pick`) or `gh` (`gh pr create`, `gh pr merge`, `gh issue comment`, `gh release upload`) anywhere in the chain sends the hero to the Farm, where it works the land (git → watering animation). Their read-only halves — `git status`/`log`/`diff`, `gh pr view`/`list`/`checks` — stay at the Arena by choice, so the Farm keeps meaning "published something" and an agent watching CI isn't parked there for ten minutes. `cost` + `costKnown` carry the session's estimated USD spend. `configDir` can be `~/.claude*` or `~/.codex`; the `source` field (`'claude' | 'codex'`) discriminates which provider produced the session.

## Design Spec

Full spec with building mappings, hero classes, VFX, panel layouts, and asset pipeline: `docs/specs/2026-04-15-agent-quest-design.md`
