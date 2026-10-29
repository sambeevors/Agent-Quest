import type { ActivityMs, AgentActivity, AgentState, Segment } from '../types/agent';

/**
 * How station time turns into items and XP.
 *
 * The server owns the time itself (server/src/progress/station-time.ts): it
 * credits the gap between two events to what the agent was doing, capped,
 * from event timestamps alone. Between its pushes the client projects the
 * open segment with the same caps, so a count ticks over on screen when it
 * actually crosses — keep the caps here in sync with the server's.
 */

export const WORK_CAP_MS = 5 * 60_000;
export const IDLE_CAP_MS = 30 * 60_000;

/** One item per minute at a station. */
export const ITEM_MS = 60_000;

/** One XP per second at any station, the Pokémon Center included. */
export const XP_PER_SECOND = 1;

export const MAX_LEVEL = 100;

const ACTIVITIES: readonly AgentActivity[] = [
  'reading', 'editing', 'thinking', 'bash', 'idle', 'git', 'debugging', 'reviewing',
];

export function capFor(activity: AgentActivity): number {
  return activity === 'idle' ? IDLE_CAP_MS : WORK_CAP_MS;
}

/** The open segment's time so far, capped as the server will cap it on close. */
export function openMs(segment: Segment, now: number): number {
  return Math.max(0, Math.min(now - segment.since, capFor(segment.activity)));
}

/**
 * An agent's station time right now. A finished session's open segment is
 * left out, as the server leaves it out — nothing is happening in it.
 */
export function liveActivityMs(agent: Pick<AgentState, 'status' | 'activityMs' | 'segment'>, now: number): ActivityMs {
  const out: ActivityMs = { ...agent.activityMs };
  const seg = agent.segment;
  if (seg !== undefined && agent.status !== 'completed' && agent.status !== 'error') {
    const open = openMs(seg, now);
    if (open > 0) out[seg.activity] = (out[seg.activity] ?? 0) + open;
  }
  return out;
}

/** Larger figure per activity. Returns `prev` itself when `next` adds nothing. */
export function mergeMax(prev: ActivityMs, next: ActivityMs): ActivityMs {
  let out: ActivityMs | null = null;
  for (const a of ACTIVITIES) {
    const n = next[a];
    if (n !== undefined && n > (prev[a] ?? 0)) {
      out ??= { ...prev };
      out[a] = n;
    }
  }
  return out ?? prev;
}

export function totalMs(ms: ActivityMs): number {
  let sum = 0;
  for (const a of ACTIVITIES) sum += ms[a] ?? 0;
  return sum;
}

export function itemsFor(ms: number): number {
  return Math.floor(ms / ITEM_MS);
}

export function xpFor(ms: ActivityMs): number {
  return Math.floor((totalMs(ms) / 1000) * XP_PER_SECOND);
}

/** Largest n with n³ ≤ x — exact, where Math.cbrt can land a hair under. */
function icbrt(x: number): number {
  let n = Math.floor(Math.cbrt(x));
  while ((n + 1) ** 3 <= x) n++;
  while (n > 0 && n ** 3 > x) n--;
  return n;
}

/**
 * FireRed's medium-fast growth: a Pokémon at level n has n³ experience. The
 * partner starts at its level in the trainer's real party, so `xp` is what
 * the agents have added on top of that.
 */
export function levelFor(baseLevel: number, xp: number): number {
  return Math.min(MAX_LEVEL, Math.max(baseLevel, icbrt(baseLevel ** 3 + xp)));
}

/** How far through its current level a partner is, for an XP bar. */
export function levelProgress(baseLevel: number, xp: number): { level: number; into: number; needed: number } {
  const level = levelFor(baseLevel, xp);
  if (level >= MAX_LEVEL) return { level, into: 0, needed: 0 };
  const total = baseLevel ** 3 + xp;
  const floor = level ** 3;
  return { level, into: Math.max(0, total - floor), needed: (level + 1) ** 3 - floor };
}
