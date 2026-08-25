import type { AgentActivity, AgentState } from '../types/agent';
import { isCostKnown } from '../types/agent';

/**
 * Per-session "report card" derived purely from an AgentState. Kept as a pure
 * function so it's testable and DB-ready: the same shape can later be produced
 * from persisted events instead of the live snapshot, without touching the UI.
 *
 * Token COUNTS are exact (straight from the JSONL). The dollar figure is an
 * ESTIMATE the server computes at public list prices (see
 * `server/src/pricing/model-pricing.ts`) and carries two caveats the UI must
 * keep visible: it excludes the session's subagents, which are separate agents
 * here, and it is list-price arithmetic rather than a subscription bill.
 * `costKnown` goes false when an unpriced model contributed, making the number
 * a lower bound.
 */

export interface ActivitySlice {
  activity: AgentActivity;
  count: number;
  pct: number; // 0..100 of total tool calls
}

export interface SessionReport {
  durationMs: number;
  toolTotal: number;
  byActivity: ActivitySlice[];
  topTools: { name: string; count: number }[];
  filesModified: number;
  errorCount: number;
  hasTokens: boolean;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  /** Estimated USD for this session alone, excluding its subagents. */
  cost: number;
  /** False when an unpriced model contributed — `cost` is then a lower bound. */
  costKnown: boolean;
  source: AgentState['source'];
  model?: string;
}

const TOOL_ACTIVITY_MAP: Record<string, AgentActivity> = {
  Read: 'reading', Grep: 'reading', Glob: 'reading',
  Edit: 'editing', Write: 'editing', NotebookEdit: 'editing',
  Bash: 'bash',
  Task: 'reviewing', Agent: 'reviewing',
};

function toolToActivity(name: string): AgentActivity {
  return TOOL_ACTIVITY_MAP[name] ?? 'thinking';
}

export function computeSessionReport(agent: AgentState): SessionReport {
  const durationMs = Math.max(0, agent.lastEvent - agent.sessionStart);

  const activityCounts = new Map<AgentActivity, number>();
  const toolCounts = new Map<string, number>();
  for (const tc of agent.toolCalls) {
    const act = toolToActivity(tc.name);
    activityCounts.set(act, (activityCounts.get(act) ?? 0) + 1);
    toolCounts.set(tc.name, (toolCounts.get(tc.name) ?? 0) + 1);
  }
  const toolTotal = agent.toolCalls.length;

  const byActivity: ActivitySlice[] = [...activityCounts.entries()]
    .map(([activity, count]) => ({ activity, count, pct: toolTotal > 0 ? (count / toolTotal) * 100 : 0 }))
    .sort((a, b) => b.count - a.count);

  const topTools = [...toolCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const tu = agent.tokenUsage;
  const total = tu.input + tu.output + tu.cacheRead + tu.cacheWrite;

  return {
    durationMs,
    toolTotal,
    byActivity,
    topTools,
    filesModified: agent.filesModified.length,
    errorCount: agent.errors.length,
    hasTokens: total > 0,
    tokens: { input: tu.input, output: tu.output, cacheRead: tu.cacheRead, cacheWrite: tu.cacheWrite, total },
    cost: agent.cost,
    costKnown: isCostKnown(agent),
    source: agent.source,
    model: agent.model,
  };
}
