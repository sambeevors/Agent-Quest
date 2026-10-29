import type { ActivityMs, AgentActivity, AgentSource, AgentState, LedgerEntry } from '../types/agent';
import { trainerFor, trainerName, type Trainer } from '../naming/hero-names';
import { itemsFor, levelFor, liveActivityMs, mergeMax, xpFor } from './accrual';
import { speciesAt } from './evolution';
import { STATION_ORDER } from './stations';

/**
 * The town's tallies: every session's station time folded into items and
 * XP, per trainer and for the whole fleet.
 *
 * A trainer is the roster entry a session hashes to (naming/hero-names.ts),
 * so a trainer's tally spans every session that has been that trainer —
 * Youngster Joey keeps levelling his Rattata across sessions and restarts.
 */

export type ItemCounts = Record<AgentActivity, number>;

export interface SessionTime {
  source: AgentSource;
  activityMs: ActivityMs;
}

export interface TrainerTally {
  key: string;
  trainer: Trainer;
  source: AgentSource;
  activityMs: ActivityMs;
  items: ItemCounts;
  xp: number;
  level: number;
  /** The partner as it is now, evolved if its level says so. */
  species: number;
  sessions: number;
}

export interface Tally {
  global: { activityMs: ActivityMs; items: ItemCounts; xp: number };
  byTrainer: Map<string, TrainerTally>;
  /** Items per session — what a +1 is diffed against. */
  bySession: Map<string, ItemCounts>;
}

export function trainerKey(agentId: string, source: AgentSource): string {
  return `${source}:${trainerName(trainerFor(agentId, source))}`;
}

function zeroItems(): ItemCounts {
  return { reading: 0, editing: 0, thinking: 0, bash: 0, idle: 0, git: 0, debugging: 0, reviewing: 0 };
}

function addMs(into: ActivityMs, ms: ActivityMs): void {
  for (const a of STATION_ORDER) {
    const v = ms[a];
    if (v !== undefined) into[a] = (into[a] ?? 0) + v;
  }
}

/**
 * Fold the ledger and the live agents into each session's station time.
 * Takes the larger figure per activity and never lowers one, so a count on
 * screen can't tick backwards when a projected segment is closed a little
 * short (or a finished session stops projecting). Mutates and returns `prev`.
 */
export function foldSessions(
  prev: Map<string, SessionTime>,
  ledger: Iterable<LedgerEntry>,
  agents: readonly AgentState[],
  now: number,
): Map<string, SessionTime> {
  const fold = (id: string, source: AgentSource, ms: ActivityMs) => {
    const had = prev.get(id);
    if (had === undefined) prev.set(id, { source, activityMs: { ...ms } });
    else had.activityMs = mergeMax(had.activityMs, ms);
  };
  for (const e of ledger) fold(e.id, e.source, e.activityMs);
  for (const a of agents) fold(a.id, a.source, liveActivityMs(a, now));
  return prev;
}

export function aggregate(sessions: ReadonlyMap<string, SessionTime>): Tally {
  const global = { activityMs: {} as ActivityMs, items: zeroItems(), xp: 0 };
  const byTrainer = new Map<string, TrainerTally>();
  const bySession = new Map<string, ItemCounts>();

  for (const [id, s] of sessions) {
    const items = zeroItems();
    for (const a of STATION_ORDER) items[a] = itemsFor(s.activityMs[a] ?? 0);
    bySession.set(id, items);
    const xp = xpFor(s.activityMs);

    const key = trainerKey(id, s.source);
    let t = byTrainer.get(key);
    if (t === undefined) {
      const trainer = trainerFor(id, s.source);
      t = {
        key, trainer, source: s.source, activityMs: {}, items: zeroItems(), xp: 0,
        level: trainer.partnerLevel, species: trainer.partner, sessions: 0,
      };
      byTrainer.set(key, t);
    }
    addMs(t.activityMs, s.activityMs);
    for (const a of STATION_ORDER) {
      t.items[a] += items[a];
      global.items[a] += items[a];
    }
    t.xp += xp;
    t.sessions++;
    addMs(global.activityMs, s.activityMs);
    global.xp += xp;
  }

  for (const t of byTrainer.values()) {
    t.level = levelFor(t.trainer.partnerLevel, t.xp);
    t.species = speciesAt(t.trainer.partner, t.level);
  }
  return { global, byTrainer, bySession };
}

export type ProgressEvent =
  | { kind: 'earned'; agentId: string; activity: AgentActivity; count: number }
  | { kind: 'levelup'; agentId: string; level: number }
  | { kind: 'evolve'; agentId: string; from: number; to: number };

/**
 * What changed between two tallies, for the agents on screen: the items
 * each one just earned, and its partner levelling up or evolving. Nothing
 * on the first tally, and nothing for a session's first appearance — loading
 * the page (or discovering an old session) isn't earning a thing.
 */
export function diffProgress(
  prev: Tally | null,
  next: Tally,
  agents: readonly Pick<AgentState, 'id' | 'source'>[],
): ProgressEvent[] {
  if (prev === null) return [];
  const out: ProgressEvent[] = [];
  for (const a of agents) {
    const before = prev.bySession.get(a.id);
    const after = next.bySession.get(a.id);
    // A session seen for the first time arrives with whatever it already had.
    if (before !== undefined && after !== undefined) {
      for (const act of STATION_ORDER) {
        const count = after[act] - before[act];
        if (count > 0) out.push({ kind: 'earned', agentId: a.id, activity: act, count });
      }
    }
    const key = trainerKey(a.id, a.source);
    const was = prev.byTrainer.get(key);
    const is = next.byTrainer.get(key);
    if (was === undefined || is === undefined) continue;
    if (is.level > was.level) out.push({ kind: 'levelup', agentId: a.id, level: is.level });
    if (is.species !== was.species) out.push({ kind: 'evolve', agentId: a.id, from: was.species, to: is.species });
  }
  return out;
}
