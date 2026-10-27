# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Agent Quest is a browser-based monitoring dashboard that visualizes active Claude Code and Codex agent sessions as Pokémon trainers walking around **Cerulean City, exactly as Pokémon FireRed draws it**. Each agent is a real FireRed trainer who walks the town's streets to the place matching its current activity (Read → Trade House, Edit → Bike Shop, Bash → Nugget Bridge, etc.), trailed by the Pokémon it sends out last.

This repository is a fork of [FulAppiOS/Agent-Quest](https://github.com/FulAppiOS/Agent-Quest). Beyond upstream it adds cost tracking and replaces the whole world with FireRed's (an educational, non-commercial branch: the art is Nintendo / Game Freak / The Pokémon Company's) — see "Fork additions", "The town" and "Art pipeline" below. There is one world and one art set; there is no theme switch.

## Architecture

Two-process monorepo:

- **server/** — Bun + Hono backend. Two providers run in parallel: `ClaudeProvider` auto-discovers every `~/.claude*` directory with a `projects/` subdir (e.g. `~/.claude`, `~/.claude-work`, `~/.claude-personale`); `CodexProvider` watches `~/.codex/sessions/` for Codex rollout files. Both poll their session logs every 2-3s, parse events into `AgentState` objects, push updates over native Bun WebSocket. Each `AgentState` carries its `configDir` and a `source` field (`'claude' | 'codex'`) so the UI can distinguish installations and providers. Optional Hono endpoint receives Claude Code `postToolUse` hooks for lower-latency events — **Claude Code only**; Codex doesn't expose hooks. `SessionRegistry` (pidfile oracle) is also **Claude-only by design**; Codex liveness is inferred purely from rollout-file activity.
- **client/** — React 19 + Phaser 4 "Caladan" frontend. The world is Cerulean City, baked into the client (`client/src/game/town/`, `client/public/assets/pokemon/town/`); the server knows nothing about the map. Fullscreen Phaser canvas renders the town; React overlay panels (Party Bar, Activity Feed, Detail Panel, Minimap, Top Bar) sit on top via ref-based bridge pattern (useRef + useEffect + EventEmitter).

- **desktop/** — Electron shell (macOS). `src/main.ts` spawns the server as a child process (Bun can't run inside Electron's Node: packaged it is a `bun build --compile` binary, from source it is `bun run`) and points it at the built client via `AGENT_QUEST_CLIENT_DIR`, so the window loads everything from :4444 (`server/src/static/client-routes.ts`). The server exits when its stdin closes (`AGENT_QUEST_EXIT_WITH_PARENT`), so a crashed shell doesn't strand :4444. Open-at-login is enabled once on first run of the installed app and is the user's after that.

Data flow: `~/.claude*/projects/**/*.jsonl` and `~/.codex/sessions/**/rollout-*.jsonl` → ClaudeProvider / CodexProvider → SessionParser (per-format) → AgentStateManager → WebSocket → Browser (React state + Phaser scene).

## Fork additions

Features this fork adds on top of upstream. Each is isolated in its own module with unit tests.

| Feature | Server | Client |
|---|---|---|
| Cost tracking | `server/src/pricing/model-pricing.ts` — family-keyed USD rates; `AgentStateManager.addUsage` prices each deduped record against the model that produced it | `formatCost`/`isCostKnown` in `types/agent.ts`; shown in TopBar, DetailPanel, SessionReport |
| Trainers | — | `naming/hero-names.ts` — `trainerFor(agentId, source)` / `heroNameFor`; roster generated into `naming/trainer-roster.ts` |
| Hero chatter | — | `game/data/hero-chatter.ts` (lines + timing) drawn by `game/entities/ThoughtBubble.ts`; scheduled per hero in `HeroSprite` |
| Cerulean City | — | `game/town/` (generated `town-data.ts`, `town.ts`, `pathfinding.ts`); `Building`, `ArenaFighters`, `FarmWork` hang meaning on it |
| FireRed art | — | `game/pokemon.ts` + generated `pokemon-sheet.ts`; baked assets under `client/public/assets/pokemon/`; bake pipeline in `scripts/bake-pokemon/` |

Notes for anyone extending these:

- **Cost is an estimate at public list prices**, never a bill. `costKnown: false` means an unpriced model contributed and the figure is a lower bound — keep the `≥` marker in any new surface that shows it.
- **Every hero is a real FireRed trainer, derived from its agent id, never stored.** The roster comes out of the decomp's own trainer table (`src/data/trainers.h`): class as the game prints it, the name it gives them ("Youngster Joey", "Lass Janice"; named characters like Red, Leaf, Blue or Prof. Oak go by name alone), the overworld sprite that class walks as, its battle portrait, and the **last Pokémon in their first party**, which follows them. Only classes with a four-way walk cycle make the roster (most gym leaders only ever stand still). Codex sessions are Team Rocket — FireRed's grunts are all just "GRUNT", so they take named members from across the series (Jessie, James, Archer…). `AgentState.name` still carries the session's real identity (slug, project folder, or subagent descriptor) and the Detail Panel shows it; the trainer name is shown everywhere else. Deriving it keeps a trainer stable across reloads and server restarts — unlike `heroClass`/`heroColor`, which are round-robin counters in `AgentStateManager` and reshuffle on restart (the colour now only tints the name label; `heroClass` no longer affects anything on screen) — and lets the Activity Feed name an agent it no longer tracks. `heroNameFor` takes the agent's `source`; a caller without one gets the Claude roster. The hash needs its avalanche step: session ids differ only in their tail (`hero-names.test.ts` pins the spread).
- **The canvas carries the trainer's name and nothing else.** Activity, model badge, current file and current prompt used to stack under every sprite, four rows deep, and the map read as a log file. That detail all lives in the React panels (Party Bar, Activity Feed, Detail Panel), so the sprite says what the trainer is *thinking* instead: a thought bubble every 14–36s, drawn from the pool for whatever it is doing, plus one on a fresh error. **A trainer on the road holds its tongue** — the activity flips at dispatch, so a line said mid-walk would talk about a place the trainer is still half a town away from; the timer marks the thought pending and it lands on arrival. Error lines are the exception: they are place-agnostic and fire on sight. Two things the lines must keep — they speak in the register of the **place** the activity sends the trainer to (the Pokémon Center heals, the Gym judges) rather than naming the tool, and nothing in them is derived from session state, so a bubble can never go stale or leak a path into a screenshot. `hero-chatter.test.ts` pins both. A waiting trainer pulses its *name*'s alpha. **The name sorts in a band of its own** (`HERO_LABEL_DEPTH` in `game/text.ts`), above every y-sorted sprite and the town's overhead layer; the sprite itself stays y-sorted.

## The town

The world is **FireRed's Cerulean City, block for block** — not a map drawn for this app, and nothing in it is generated at runtime. `scripts/bake-pokemon/town.py` renders it from the pret/pokefirered decompilation's map data (`map.bin` → metatiles → 8x8 tiles in the map's palettes, via `frlg.py`), with the four connected routes (Route 24 and Nugget Bridge north, Route 4 west, Route 9 east, Route 5 south) placed at their real connection offsets, and the town's own `border.bin` filling the rest — the game's own rule past a map's edge. Cut trees are object events, not blocks, so the bake draws and blocks them separately.

| Layer | Source | Where it lives |
|---|---|---|
| Ground (everything under sprites) | bottom tile layer, plus the top layer of COVERED metatiles | `assets/pokemon/town/ground.png`, depth 0 |
| Overhead (roof eaves, tree crowns) | top layer of NORMAL/SPLIT metatiles | `overhead.png`, `OVERHEAD_DEPTH` in `VillageScene` — above every sprite, below labels |
| Walk grid | collision bits clear, behaviour not water or a ledge, reachable from the spawn | `town-data.ts` `walk` |
| Doors | the map's warp events | `town-data.ts` per building; open frame = last frame of the door's real animation (`graphics/door_anims`, palette per `field_door.c`) |

Everything is at x2: one 16px block is one 32px tile. A hero's position on a tile is its **feet** (`footOf`), the way an overworld sprite stands in the game; `HeroSprite.moveTo` takes feet.

**Trainers move the way FireRed characters do.** `town/pathfinding.ts` is 4-way A* over the walk grid, preferring straight runs on ties so routes read as streets rather than staircases, and returns only the corners. There is no road network and no desire-path generator any more — the old village's generated roads, scenery, shoreline and critters were all removed with it, because the real town already has streets. Only the part of the map reachable from the spawn is walkable: the flower garden north of the Badge House is reached through that house's back door in the game, so here it is scenery.

**Where each activity goes** (`BUILDINGS` in `town.py`; ids are the old activity slots, kept so settings and panels keep working): idle → Pokémon Center, debugging → Poké Mart, reviewing → Cerulean Gym, editing → Bike Shop (its rect includes the bike rack at x 11), reading → Trade House, thinking → Badge House, bash → Nugget Bridge, git → the flower bed beside the Bike Shop. Each building carries baked **slots**: the doorstep first, then outward by walking distance — one trainer per tile, no two places sharing one, and no crowd allowed onto the flower bed (`pathfinding.test.ts` pins it). **At a building the trainer goes inside** (`HeroSprite.goInside`): it walks to the doorstep (that is its arrival — the door opens), steps up through the door and vanishes, and its partner walks to the trainer's slot and waits there facing the door, with the trainer's name and thought bubbles hanging over it — so a building's slots hold partners, and counting them tells you who is in. The partner is clickable and selects its trainer. Leaving, the partner goes back to the doorstep first and the trainer reappears in the doorway beside it; a trainer already inside whose slot only moves (the queue shuffled up) stays in and just its partner moves over. Out of doors — Nugget Bridge and the flower bed — trainers stay out with their partners at heel; a trainer on the bridge faces its Pokémon.

**Nothing in the town means something unless it does.** Two pieces of ambience are signal: **a building's door stands open only while a trainer is inside** (`Building.setOccupied`) and **the Rocket's Ekans and Zubat on Nugget Bridge battle only while a trainer is on the bridge** (`ArenaFighters.setFighting`), and each front-row trainer who has arrived there sends its partner out onto the tile in front of it (one partner per tile, so they never pile onto a shared foe; further back, that tile is another trainer's and the partner stays at heel) to fight on the same beat — lunge, hit flash, hop (`HeroSprite.setBattling`, `BATTLE_FRAMES` in `pokemon.ts`); the bridge's slots run from the Pokémon back towards town, so a lone trainer stands right in front of them — both driven from `VillageScene.refreshOccupancy`. That reads the `arrived` set, **not** the slot assignment: a trainer's slot flips the instant its activity does, while it is still walking, and a door that opens for a trainer crossing town is telling you something that isn't true yet. `HeroSprite.moveTo` takes an `onArrive` callback (synchronous if the trainer is already on its spot) which raises occupancy; the sweep at the end of `handleAgentUpdate` is what lowers it. The Bike Shop's door has no animation in the game, so it has no tell. The flower bed's trainers are owned by `FarmWork`, which moves them between its tiles every 4.5–11s — creature motion, deliberately not seeded.

If something about the town looks wrong, fix the bake (`town.py`) and re-run it — never edit `town-data.ts` or a baked PNG by hand.

## Art pipeline (FireRed)

`scripts/bake-pokemon/bake.py` reads two local checkouts (sparse is enough — see its docstring), neither committed: **pret/pokefirered** for the town, the trainer table, overworld sprites (`overworld.py` resolves each pic's real palette through the decomp's object-event tables) and battle portraits; **PokeAPI/sprites** for Gen III party icons (partners, and the bridge's Pokémon). It writes PNGs under `client/public/assets/pokemon/` and three generated modules: `game/town/town-data.ts`, `naming/trainer-roster.ts`, `game/pokemon-sheet.ts`. The outputs are committed, so nobody else ever runs the bake. `bun run check:assets` verifies every path the game loads; `pokemon.test.ts` pins the bake's sizes.

- **Trainers** are 16x32 four-way walkers re-laid as 12 frames (down/up/left/right × stand, step, step; right is left mirrored), rendered at x2. A parked trainer always stands on its stand frame, facing its spot — it only steps while it is actually walking (`HeroSprite.playStationary`).
- **Portraits** are the battle front pics, cropped square to the face, for every React avatar.
- **Panel chrome** is a FireRed-style 9-slice (`pokemon-ui.css`, `assets/pokemon/ui/`) — chrome only; layout, text palette and RuneScape type unchanged.

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
bun run check:assets   # Verify every baked asset the game loads exists on disk
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

**A Bash call is classified by what it actually runs**, not by the tool name — agents do much of their reading and searching through the shell (`grep -rn`, `cat`, `sed -n`, `find`), and sending all of it to the bash slot left the reading one empty. `classifyBashCommand` in `server/src/parsers/bash-activity.ts` is the single owner of that decision and both parsers call it (Codex prefers its own `parsed_cmd` when present and falls back to the classifier). It is deliberately conservative: a command reads only when *every* pipeline segment is a read or a neutral chore (`cd`, `echo`) and nothing redirects into a file — so `grep x src | head` reads, while `grep x src > out.txt`, `cat urls | xargs curl`, and `find … -exec rm` stay generic shell work. Publishing outranks reading: a write-oriented `git` (`commit`, `push`, `merge`, `rebase`, `cherry-pick`) or `gh` (`gh pr create`, `gh pr merge`, `gh issue comment`, `gh release upload`) anywhere in the chain sends the trainer to the flower bed (the `farm` slot). Their read-only halves — `git status`/`log`/`diff`, `gh pr view`/`list`/`checks` — stay on Nugget Bridge by choice, so the flower bed keeps meaning "published something" and an agent watching CI isn't parked there for ten minutes. `cost` + `costKnown` carry the session's estimated USD spend. `configDir` can be `~/.claude*` or `~/.codex`; the `source` field (`'claude' | 'codex'`) discriminates which provider produced the session.

## Design Spec

Full spec with building mappings, hero classes, VFX, panel layouts, and asset pipeline: `docs/specs/2026-04-15-agent-quest-design.md`
