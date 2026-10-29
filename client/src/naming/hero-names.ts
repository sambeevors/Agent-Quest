/**
 * Every hero is a real trainer out of Pokémon FireRed.
 *
 * A session's real identity — the Claude Code slug (`bubbly-waddling-cat`),
 * the project folder a Codex session runs in, or a subagent's descriptor
 * ("Explore") — reads like a log line rather than a townsperson, so every hero
 * is given one of the trainers the game itself names: Youngster Joey, Lass
 * Janice, Hiker Marcos… or, now and then, Red, Leaf, Blue or Prof. Oak. The
 * roster (`trainer-roster.ts`) is generated from the decompilation's trainer
 * table by scripts/bake-pokemon/, along with the sprite each class walks
 * around as, its battle portrait, and the Pokémon it sends out last — which
 * follows it around town.
 *
 * Codex sessions are Team Rocket. FireRed's grunts are all just "GRUNT", so
 * they take the names of the organisation's members from across the series.
 *
 * The trainer is DERIVED from the agent id rather than stored on `AgentState`:
 * that keeps it stable across page reloads and server restarts (unlike
 * `heroClass` / `heroColor`, which are round-robin counters in the server's
 * state manager and reshuffle when it restarts), needs no protocol change,
 * and lets the Activity Feed name an agent it no longer tracks.
 */
import type { AgentSource } from '../types/agent';
import { ROCKETS, TRAINERS } from './trainer-roster';

export interface Trainer {
  /** Trainer class as the game prints it ("Bug Catcher"); empty for named characters. */
  readonly title: string;
  readonly name: string;
  /** Overworld walker sheet: assets/pokemon/trainers/<sprite>.png. */
  readonly sprite: string;
  /** Battle portrait: assets/pokemon/portraits/<portrait>.png. */
  readonly portrait: string;
  /** National dex number of the Pokémon that follows them. */
  readonly partner: number;
  /** Its level in the trainer's own party — where its levelling starts (progress/). */
  readonly partnerLevel: number;
}

/**
 * Avalanche step (murmur3's finalizer). Session ids differ only in their
 * tail, and a plain rolling hash barely disturbs the low bits that `%` reads —
 * without it, 500 uuids landed on a third as many names as they should.
 */
function mix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** FNV-1a over the id, finalised. */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  }
  return mix(h);
}

/** The trainer an agent is — deterministic, so it never changes under a walking hero. */
export function trainerFor(agentId: string, source: AgentSource = 'claude'): Trainer {
  const pool: readonly Trainer[] = source === 'codex' ? ROCKETS : TRAINERS;
  return pool[hash(agentId) % pool.length]!;
}

/** "Youngster Joey", or just "Red" for a trainer the game names alone. */
export function trainerName(trainer: Trainer): string {
  return trainer.title === '' ? trainer.name : `${trainer.title} ${trainer.name}`;
}

/** The hero name for an agent id: the name of the trainer it is. */
export function heroNameFor(agentId: string, source: AgentSource = 'claude'): string {
  return trainerName(trainerFor(agentId, source));
}
