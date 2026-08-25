# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Agent Quest is a browser-based monitoring dashboard that visualizes active Claude Code and Codex agent sessions as fantasy heroes in a 2D WoW-style village. Each agent is represented as a hero character that walks between buildings corresponding to its current activity (Read → Library, Edit → Forge, Bash → Arena, etc.).

This repository is a fork of [FulAppiOS/Agent-Quest](https://github.com/FulAppiOS/Agent-Quest). Beyond upstream it adds cost tracking, Linear-backed construction sites, and generated roads/scenery — see "Fork additions" and "Generated map layers" below.

## Architecture

Two-process monorepo:

- **server/** — Bun + Hono backend. Two providers run in parallel: `ClaudeProvider` auto-discovers every `~/.claude*` directory with a `projects/` subdir (e.g. `~/.claude`, `~/.claude-work`, `~/.claude-personale`); `CodexProvider` watches `~/.codex/sessions/` for Codex rollout files. Both poll their session logs every 2-3s, parse events into `AgentState` objects, push updates over native Bun WebSocket. Each `AgentState` carries its `configDir` and a `source` field (`'claude' | 'codex'`) so the UI can distinguish installations and providers. Optional Hono endpoint receives Claude Code `postToolUse` hooks for lower-latency events — **Claude Code only**; Codex doesn't expose hooks. `SessionRegistry` (pidfile oracle) is also **Claude-only by design**; Codex liveness is inferred purely from rollout-file activity.
- **client/** — React 19 + Phaser 4 "Caladan" frontend. The world is a single read-only map (`server/data/map/village.json`) served by `GET /api/map`; there is no map editor. Fullscreen Phaser canvas renders the village; React overlay panels (Party Bar, Activity Feed, Detail Panel, Minimap, Top Bar) sit on top via ref-based bridge pattern (useRef + useEffect + EventEmitter).

Data flow: `~/.claude*/projects/**/*.jsonl` and `~/.codex/sessions/**/rollout-*.jsonl` → ClaudeProvider / CodexProvider → SessionParser (per-format) → AgentStateManager → WebSocket → Browser (React state + Phaser scene).

## Fork additions

Features this fork adds on top of upstream. Each is isolated in its own module with unit tests.

| Feature | Server | Client |
|---|---|---|
| Cost tracking | `server/src/pricing/model-pricing.ts` — family-keyed USD rates; `AgentStateManager.addUsage` prices each deduped record against the model that produced it | `formatCost`/`isCostKnown` in `types/agent.ts`; shown in TopBar, DetailPanel, SessionReport |
| Linear construction sites | `server/src/linear/` — key resolution (`linear-config.ts`), polling (`linear-provider.ts`), HTTP surface (`routes.ts`); `WsEvent` `linear:status` | `components/ConstructionPanel.tsx`, `components/LinearConnect.tsx`, `game/entities/ConstructionSite.ts` |
| Hero names | — | `naming/hero-names.ts` — `heroNameFor(agentId)`; the primary label on the canvas and in every panel |

Notes for anyone extending these:

- **Cost is an estimate at public list prices**, never a bill. `costKnown: false` means an unpriced model contributed and the figure is a lower bound — keep the `≥` marker in any new surface that shows it.
- **Never send the Linear key to the client.** `LinearStatus` carries `keyHint` (last 4 chars) and nothing more. The stored key lives in `server/data/linear.json` (gitignored, `0600`).
- **`LINEAR_API_KEY` beats the stored key** and disables the in-app controls, so a browser tab can't override an operator's explicit config.
- **A new key is verified against the live API before it's persisted** — surfacing a bad key at submit time rather than on the next poll.
- **Linear queries must stay cheap.** Fetching `projects × issues` exceeds Linear's 10k complexity ceiling and 400s. Read `progress` / `scope` / `*CountHistory` off the project instead.
- **A hero's name is derived from its agent id, never stored.** `AgentState.name` still carries the session's real identity (slug, project folder, or subagent descriptor) and the Detail Panel shows it under the class; the fantasy name shown everywhere else is `heroNameFor(agent.id)`. Deriving it keeps a hero's name stable across reloads and server restarts — unlike `heroClass`/`heroColor`, which are round-robin counters in `AgentStateManager` and reshuffle on restart — and lets the Activity Feed name an agent it no longer tracks. The name-picking hash needs its avalanche step: session ids differ only in their tail, and without mixing the two table indices correlate badly (`hero-names.test.ts` pins the spread).
- **The construction yard is placed relative to the spawned buildings** (`computeVillageAnnexes`), not at fixed world coordinates, so it stays correct if a building moves.

## Generated map layers

Roads and scenery are **generated at runtime**, not read from the shipped map. All are pure modules with unit tests, and all key off the buildings that actually spawned — so they stay correct when a building moves or a Linear project appears.

| Layer | Modules | Renderer |
|---|---|---|
| Roads (desire paths) | `game/data/desire-paths.ts` (routing) + `game/data/path-tiles.ts` (tiling) | `game/terrain/PathTileRenderer.ts` |
| Scenery (trees/bushes/rocks/mushrooms) | `game/data/scenery.ts` | `game/terrain/SceneryRenderer.ts` |

`VillageScene.rebuildRoads()` drives both; it re-runs when the Linear hamlet gains or loses a building.

What the shipped `MapConfig` contributes: terrain tiles, building positions, spawn point, NPCs, settings, and **placed features** (water, mines, towers, the bridge). It carries no roads and no natural scatter — both are generated.

Roads are **tiled from the ground tileset**, not painted over it, so a track meets the grass with the artist's own border rather than a procedural edge that never quite matches. The pack has only grass and beach sand, so `buildRoadTileset` in `themes/tiny-swords-cc0.ts` derives a packed-earth surface by recolouring the sand onto the brown ramp the pack already uses for its bridge and tree trunks (`SAND_TO_EARTH`). It is generated at load rather than shipped as a PNG so the recolour stays a readable table beside the palette it came from.

**Sprite size comes from the artwork, and the unit is the doorway — not the file.** `SCENERY_SCALE` covers all four scenery kinds, so a 192px tree frame and a 64px mushroom frame render at the sizes they were drawn.

Buildings need one more step, because the eight PNGs under `BuildingsCustom/` were drawn for this project at zooms that differ by a factor of two — measured on their doorways: `library 68 · tavern 70 · chapel 70 · watchtower 78` agree, `castle 60 · arena 90 · forge 115 · alchemist 140` do not. Scaling every file alike therefore produces enormous huts beside a miniature castle. `DOOR_HEIGHT` in the theme records the measurements and `getBuildingScale` divides them out, so a doorway ends up the same size on every building. **Those numbers correct the source art; they are not per-building size normalisation, which is the bug they replaced** (an earlier table stretched the Castle 29% against its neighbours and left the tallest and shortest buildings a hand apart). Redrawing the art at a consistent zoom would remove the need for the table; `tiny-swords-cc0.test.ts` pins the invariant either way.

Heroes sit on a third scale again (`MapConfig.settings.heroScale`) — a known inconsistency, not a licence to add more.

Invariants worth preserving:

- **No road may cross a building.** The routing graph heroes walk IS the road network, so this is also what stops heroes clipping. Two subtleties have already bitten here, both covered by regression tests in `desire-paths.test.ts`: a door sits inside its own building's *clearance ring*, so routes collide against that building's bare footprint rather than dropping it from the route entirely; and the organic wobble applied after routing is validated per *segment*, since a point just outside a corner can still be reached by a line through it.
- **Nothing spawns on a road, against a wall, or in the water.** Per-kind clearances live in `KIND_SPECS`; trees need far more room than mushrooms. Water is the awkward one: the lake is 204 cells of `terrain-water` in the terrain grid, not a placed feature, and every one of them is flagged `walkable: true` — so `game/data/water.ts` derives the keep-out rects from the tiles themselves rather than trusting the map to describe them.
- **Both generators are seeded and deterministic.** Scenery that reshuffles every reload is disorienting, and a road that moves under a walking hero is a bug.
- **Don't close concave corners in the road grid.** A 16-tile edge set has no inner-corner tile, and filling the notch looks like the fix — but iterating that rule is a morphological closing: it eats the grass out of every space the network encloses and turns the village into one plaza. `makeTileable` fills only pinholes and diagonal-only touches, and `path-tiles.test.ts` guards a ring of roads around an open green.

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

**A Bash call is classified by what it actually runs**, not by the tool name — agents do much of their reading and searching through the shell (`grep -rn`, `cat`, `sed -n`, `find`), and sending all of it to the Arena left the Library empty. `classifyBashCommand` in `server/src/parsers/bash-activity.ts` is the single owner of that decision and both parsers call it (Codex prefers its own `parsed_cmd` when present and falls back to the classifier). It is deliberately conservative: a command reads only when *every* pipeline segment is a read or a neutral chore (`cd`, `echo`) and nothing redirects into a file — so `grep x src | head` reads, while `grep x src > out.txt`, `cat urls | xargs curl`, and `find … -exec rm` stay generic shell work. Publishing outranks reading: a write-oriented `git` (`commit`, `push`, `merge`, `rebase`, `cherry-pick`) or `gh` (`gh pr create`, `gh pr merge`, `gh issue comment`, `gh release upload`) anywhere in the chain sends the hero to the Chapel. Their read-only halves — `git status`/`log`/`diff`, `gh pr view`/`list`/`checks` — stay at the Arena by choice, so the Chapel keeps meaning "published something" and an agent watching CI isn't parked there for ten minutes. `cost` + `costKnown` carry the session's estimated USD spend. `configDir` can be `~/.claude*` or `~/.codex`; the `source` field (`'claude' | 'codex'`) discriminates which provider produced the session.

## Design Spec

Full spec with building mappings, hero classes, VFX, panel layouts, and asset pipeline: `docs/specs/2026-04-15-agent-quest-design.md`
