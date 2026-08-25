# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Agent Quest is a browser-based monitoring dashboard that visualizes active Claude Code and Codex agent sessions as fantasy heroes in a 2D WoW-style village. Each agent is represented as a hero character that walks between buildings corresponding to its current activity (Read → Library, Edit → Forge, Bash → Arena, etc.).

This repository is a fork of [FulAppiOS/Agent-Quest](https://github.com/FulAppiOS/Agent-Quest). Beyond upstream it adds cost tracking, Linear-backed construction sites, and generated roads/scenery — see "Fork additions" and "Generated map layers" below.

## Architecture

Two-process monorepo:

- **server/** — Bun + Hono backend. Two providers run in parallel: `ClaudeProvider` auto-discovers every `~/.claude*` directory with a `projects/` subdir (e.g. `~/.claude`, `~/.claude-work`, `~/.claude-personale`); `CodexProvider` watches `~/.codex/sessions/` for Codex rollout files. Both poll their session logs every 2-3s, parse events into `AgentState` objects, push updates over native Bun WebSocket. Each `AgentState` carries its `configDir` and a `source` field (`'claude' | 'codex'`) so the UI can distinguish installations and providers. Optional Hono endpoint receives Claude Code `postToolUse` hooks for lower-latency events — **Claude Code only**; Codex doesn't expose hooks. `SessionRegistry` (pidfile oracle) is also **Claude-only by design**; Codex liveness is inferred purely from rollout-file activity.
- **client/** — React 19 + Phaser 4 "Caladan" frontend. Fullscreen Phaser canvas renders the village; React overlay panels (Party Bar, Activity Feed, Detail Panel, Minimap, Top Bar) sit on top via ref-based bridge pattern (useRef + useEffect + EventEmitter).

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
- **The construction yard is placed relative to the spawned buildings** (`computeVillageAnnexes`), not at fixed world coordinates, because the map editor lets users move everything.

## Generated map layers

Roads and scenery are **generated at runtime**, not read from the saved map. Both are pure modules with unit tests, and both key off the buildings that actually spawned — so they stay correct when a building moves, the map editor is used, or a Linear project appears.

| Layer | Module | Renderer |
|---|---|---|
| Roads (desire paths) | `game/data/desire-paths.ts` | `game/terrain/DesirePathRenderer.ts` |
| Scenery (trees/bushes/rocks/mushrooms) | `game/data/scenery.ts` | `game/terrain/SceneryRenderer.ts` |

`VillageScene.rebuildRoads()` drives both; it re-runs when the Linear hamlet gains or loses a building.

What a saved `MapConfig` still contributes: terrain tiles, building positions, spawn point, NPCs, settings, and **placed features** (water, mines, towers). What it no longer contributes: `paths` (superseded by generated roads) and natural scatter (regenerated — see `SCATTER_PREFIXES` in `MapConfigRenderer`). The editor's path tool therefore no longer affects the village view.

Invariants worth preserving:

- **No road may cross a building.** The routing graph heroes walk IS the road network, so this is also what stops heroes clipping. Two subtleties have already bitten here, both covered by regression tests in `desire-paths.test.ts`: a door sits inside its own building's *clearance ring*, so routes collide against that building's bare footprint rather than dropping it from the route entirely; and the organic wobble applied after routing is validated per *segment*, since a point just outside a corner can still be reached by a line through it.
- **Nothing spawns on a road or against a wall.** Per-kind clearances live in `KIND_SPECS`; trees need far more room than mushrooms.
- **Both generators are seeded and deterministic.** Scenery that reshuffles every reload is disorienting, and a road that moves under a walking hero is a bug.

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
