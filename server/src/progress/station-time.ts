import type { ActivityMs, AgentActivity, Segment } from '../types';

/**
 * Time each agent spends at each station, the ledger behind the town's items
 * and XP.
 *
 * Driven by event timestamps alone: the gap between two events is credited to
 * whatever the agent was doing after the first. Nothing here reads the clock,
 * so replaying a session's JSONL (the server re-reads the last 3h on every
 * start) rebuilds exactly the same totals — the ledger can merge them by max
 * and never count a minute twice. The lifecycle timers that force an agent
 * idle have no timestamp evidence behind them and deliberately don't touch it.
 *
 * Kept in sync with client/src/progress/accrual.ts, which projects the open
 * segment between pushes with the same caps.
 */

/**
 * The longest single gap credited to an activity. A silence longer than this
 * means the agent wasn't really doing it — a session left on a Read overnight
 * must not come back with eight hours of reading. Idle gets longer: it is the
 * wait for the user, which is genuinely that long.
 */
export const WORK_CAP_MS = 5 * 60_000;
export const IDLE_CAP_MS = 30 * 60_000;

export function capFor(activity: AgentActivity): number {
  return activity === 'idle' ? IDLE_CAP_MS : WORK_CAP_MS;
}

/**
 * Close the open segment at `t` and open the next one there. Out-of-order
 * events (t before the segment opened) credit nothing and leave it open.
 */
export function accrue(activityMs: ActivityMs, segment: Segment, t: number, next: AgentActivity): Segment {
  if (t < segment.since) return segment;
  const gap = Math.min(t - segment.since, capFor(segment.activity));
  if (gap > 0) activityMs[segment.activity] = (activityMs[segment.activity] ?? 0) + gap;
  return { activity: next, since: t };
}

/** The open segment's time so far, capped as it would be on close. */
export function openMs(segment: Segment, now: number): number {
  return Math.max(0, Math.min(now - segment.since, capFor(segment.activity)));
}
