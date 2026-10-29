import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ActivityMs, AgentActivity, AgentSource, AgentState, LedgerEntry } from '../types';
import { AGENT_SOURCES } from '../types';
import { openMs } from './station-time';

/**
 * Every session's station time, kept on disk so the town's tallies outlive
 * the agents that earned them — the state manager forgets a session two hours
 * after it completes, and only re-reads the last three hours on a restart.
 *
 * Entries merge by taking the larger figure per activity, never by adding.
 * A replayed session rebuilds the same totals it had before (station-time.ts
 * reads only event timestamps), so a restart lands on the figures already
 * here and changes nothing.
 */

const ACTIVITIES: readonly AgentActivity[] = [
  'reading', 'editing', 'thinking', 'bash', 'idle', 'git', 'debugging', 'reviewing',
];

export function defaultLedgerPath(): string {
  const dir = process.env.POKEAGENT_DATA_DIR ?? join(homedir(), '.pokeagent');
  return join(dir, 'ledger.json');
}

/**
 * An agent's station time as of `now`: closed segments plus the open one so
 * far. A finished session's open segment is left out — nothing is happening
 * in it, and a session replayed hours later would otherwise be credited a
 * full cap of time the clock invented.
 */
export function stationTime(agent: AgentState, now: number): ActivityMs {
  const out: ActivityMs = { ...agent.activityMs };
  if (agent.status !== 'completed' && agent.status !== 'error') {
    const open = openMs(agent.segment, now);
    if (open > 0) out[agent.segment.activity] = (out[agent.segment.activity] ?? 0) + open;
  }
  return out;
}

/** Larger figure per activity. Returns null when `next` adds nothing to `prev`. */
export function mergeMax(prev: ActivityMs, next: ActivityMs): ActivityMs | null {
  let changed = false;
  const out: ActivityMs = { ...prev };
  for (const a of ACTIVITIES) {
    const n = next[a];
    if (n !== undefined && n > (out[a] ?? 0)) {
      out[a] = n;
      changed = true;
    }
  }
  return changed ? out : null;
}

/** Read entries back defensively: a bad file starts an empty ledger, a bad entry is dropped. */
export function parseLedger(raw: string): LedgerEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = (data as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(list)) return [];
  const out: LedgerEntry[] = [];
  for (const e of list as Array<Record<string, unknown>>) {
    if (e === null || typeof e !== 'object') continue;
    if (typeof e.id !== 'string') continue;
    if (!AGENT_SOURCES.includes(e.source as AgentSource)) continue;
    const ms: ActivityMs = {};
    const raw = e.activityMs as Record<string, unknown> | undefined;
    for (const a of ACTIVITIES) {
      const v = raw?.[a];
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) ms[a] = v;
    }
    out.push({
      id: e.id,
      source: e.source as AgentSource,
      activityMs: ms,
      lastSeen: typeof e.lastSeen === 'number' ? e.lastSeen : 0,
    });
  }
  return out;
}

export class Ledger {
  private entries = new Map<string, LedgerEntry>();
  private dirty = false;

  constructor(private readonly path: string) {}

  /** Load the file if there is one. Missing or corrupt → empty. */
  load(): void {
    let raw: string;
    try {
      raw = readFileSync(this.path, 'utf8');
    } catch {
      return;
    }
    for (const e of parseLedger(raw)) this.entries.set(e.id, e);
  }

  /**
   * Fold each agent's station time into its entry. Returns the entries that
   * grew, for the caller to broadcast.
   */
  record(agents: readonly AgentState[], now: number): LedgerEntry[] {
    const changed: LedgerEntry[] = [];
    for (const agent of agents) {
      const prev = this.entries.get(agent.id);
      const merged = mergeMax(prev?.activityMs ?? {}, stationTime(agent, now));
      if (merged === null) continue;
      const entry: LedgerEntry = {
        id: agent.id,
        source: agent.source,
        activityMs: merged,
        lastSeen: Math.max(prev?.lastSeen ?? 0, agent.lastEvent),
      };
      this.entries.set(agent.id, entry);
      changed.push(entry);
      this.dirty = true;
    }
    return changed;
  }

  all(): LedgerEntry[] {
    return [...this.entries.values()];
  }

  /** Write if anything changed since the last save. Atomic: tmp file, then rename. */
  save(): void {
    if (!this.dirty) return;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version: 1, entries: this.all() }));
      renameSync(tmp, this.path);
      this.dirty = false;
    } catch (err) {
      console.warn('[Ledger] save failed:', err);
    }
  }
}
