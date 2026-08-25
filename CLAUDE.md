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

Notes for anyone extending these:

- **Cost is an estimate at public list prices**, never a bill. `costKnown: false` means an unpriced model contributed and the figure is a lower bound — keep the `≥` marker in any new surface that shows it.
- **Never send the Linear key to the client.** `LinearStatus` carries `keyHint` (last 4 chars) and nothing more. The stored key lives in `server/data/linear.json` (gitignored, `0600`).
- **`LINEAR_API_KEY` beats the stored key** and disables the in-app controls, so a browser tab can't override an operator's explicit config.
- **A new key is verified against the live API before it's persisted** — surfacing a bad key at submit time rather than on the next poll.
- **Linear queries must stay cheap.** Fetching `projects × issues` exceeds Linear's 10k complexity ceiling and 400s. Read `progress` / `scope` / `*CountHistory` off the project instead.
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

**Sprites are scaled by family, never per asset.** `theme.buildingScale` covers all eight buildings and `SCENERY_SCALE` all four scenery kinds, so a PNG drawn twice as large renders twice as large. Per-asset scales are how the artist's intent gets quietly overruled — the previous table stretched the Castle 29% against its neighbours and inflated bushes 60% against the trees. The two constants differ because `BuildingsCustom/` is drawn at roughly twice the Tiny Swords pixel density; heroes are on a third scale again (`MapConfig.settings.heroScale`), which is a known inconsistency, not a licence to add more.

Invariants worth preserving:

- **No road may cross a building.** The routing graph heroes walk IS the road network, so this is also what stops heroes clipping. Two subtleties have already bitten here, both covered by regression tests in `desire-paths.test.ts`: a door sits inside its own building's *clearance ring*, so routes collide against that building's bare footprint rather than dropping it from the route entirely; and the organic wobble applied after routing is validated per *segment*, since a point just outside a corner can still be reached by a line through it.
- **Nothing spawns on a road or against a wall.** Per-kind clearances live in `KIND_SPECS`; trees need far more room than mushrooms.
- **Both generators are seeded and deterministic.** Scenery that reshuffles every reload is disorienting, and a road that moves under a walking hero is a bug.
- **Don't close concave corners in the road grid.** A 16-tile edge set has no inner-corner tile, and filling the notch looks like the fix — but iterating that rule is a morphological closing: it eats the grass out of every space the network encloses and turns the village into one plaza. `makeTileable` fills only pinholes and diagonal-only touches, and `path-tiles.test.ts` guards a ring of roads around an open green.

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

The central data model flows from server to client. Defined in shared types. Maps tool calls to activities: Read/Grep/Glob → `reading`, Edit/Write → `editing`, Bash → `bash`, thinking → `thinking`, git → `git`, idle → `idle`, debug → `debugging`, review → `reviewing`. `cost` + `costKnown` carry the session's estimated USD spend. `configDir` can be `~/.claude*` or `~/.codex`; the `source` field (`'claude' | 'codex'`) discriminates which provider produced the session.

## Design Spec

Full spec with building mappings, hero classes, VFX, panel layouts, and asset pipeline: `docs/specs/2026-04-15-agent-quest-design.md`
