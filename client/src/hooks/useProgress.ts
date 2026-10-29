import { useEffect, useRef, useState } from 'react';
import type { AgentState, LedgerEntry } from '../types/agent';
import { eventBridge } from '../game/EventBridge';
import { aggregate, diffProgress, foldSessions, trainerKey, type SessionTime, type Tally } from '../progress/tally';

/** How often the tally is recomputed — often enough that a +1 lands within a second of being earned. */
const TICK_MS = 1000;

/** What VillageScene needs to draw each hero's partner: its species and level. */
export type PartnerStates = Record<string, { species: number; level: number }>;

/**
 * The town's tallies, live. Folds the server's ledger and the agents' open
 * segments into items and XP every second, and tells the town what changed:
 *
 * - `progress:earned` / `progress:levelup` / `progress:evolve` — one-shot,
 *   for the popups over a trainer's head;
 * - `progress:partners` (sticky) — every live hero's partner species and
 *   level, so a hero spawned later still walks out with the right Pokémon.
 */
export function useProgress(agents: readonly AgentState[], ledger: ReadonlyMap<string, LedgerEntry>): Tally | null {
  const [tally, setTally] = useState<Tally | null>(null);
  const sessions = useRef(new Map<string, SessionTime>());
  const prev = useRef<Tally | null>(null);
  const input = useRef({ agents, ledger });
  input.current = { agents, ledger };

  useEffect(() => {
    const tick = () => {
      const { agents: live, ledger: entries } = input.current;
      const next = aggregate(foldSessions(sessions.current, entries.values(), live, Date.now()));
      for (const e of diffProgress(prev.current, next, live)) eventBridge.emit(`progress:${e.kind}`, e);
      prev.current = next;

      const partners: PartnerStates = {};
      for (const a of live) {
        const t = next.byTrainer.get(trainerKey(a.id, a.source));
        if (t !== undefined) partners[a.id] = { species: t.species, level: t.level };
      }
      eventBridge.emit('progress:partners', partners);
      setTally(next);
    };
    tick();
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, []);

  return tally;
}
