import { describe, test, expect } from 'bun:test';
import { accrue, openMs, IDLE_CAP_MS, WORK_CAP_MS } from './station-time';
import { AgentStateManager } from '../state/agent-state-manager';
import type { ParsedEvent } from '../parsers/session-parser';
import type { ActivityMs } from '../types';

const T0 = 1_700_000_000_000;

function makeEvent(at: number, overrides: Partial<ParsedEvent> = {}): ParsedEvent {
  return {
    sessionId: 'sess-1',
    slug: 'bubbly-waddling-cat',
    timestamp: T0 + at,
    activity: 'reading',
    toolCalls: [],
    file: undefined,
    command: undefined,
    cwd: '/project',
    ...overrides,
  };
}

function replay(events: ParsedEvent[]): ActivityMs {
  const mgr = new AgentStateManager();
  for (const e of events) mgr.processEvent({ ...e });
  return mgr.getAgent('sess-1')!.activityMs;
}

describe('accrue', () => {
  test('credits the gap to the activity that was open', () => {
    const ms: ActivityMs = {};
    const seg = accrue(ms, { activity: 'reading', since: 0 }, 40_000, 'editing');
    expect(ms).toEqual({ reading: 40_000 });
    expect(seg).toEqual({ activity: 'editing', since: 40_000 });
  });

  test('caps a long silence', () => {
    const ms: ActivityMs = {};
    accrue(ms, { activity: 'thinking', since: 0 }, 3_600_000, 'idle');
    accrue(ms, { activity: 'idle', since: 0 }, 3_600_000, 'reading');
    expect(ms).toEqual({ thinking: WORK_CAP_MS, idle: IDLE_CAP_MS });
  });

  test('an out-of-order event credits nothing and leaves the segment open', () => {
    const ms: ActivityMs = {};
    const seg = { activity: 'bash' as const, since: 10_000 };
    expect(accrue(ms, seg, 5_000, 'reading')).toBe(seg);
    expect(ms).toEqual({});
  });

  test('openMs is capped and never negative', () => {
    expect(openMs({ activity: 'bash', since: 0 }, 30_000)).toBe(30_000);
    expect(openMs({ activity: 'bash', since: 0 }, 99 * 60_000)).toBe(WORK_CAP_MS);
    expect(openMs({ activity: 'bash', since: 10 }, 0)).toBe(0);
  });
});

describe('station time in AgentStateManager', () => {
  const session = [
    makeEvent(0, { activity: 'reading' }),
    makeEvent(60_000, { activity: 'editing' }),
    makeEvent(90_000, { activity: 'bash' }),
    makeEvent(150_000, { activity: 'thinking', isTurnEnd: true }),
    makeEvent(750_000, { kind: 'task', activity: 'thinking', currentTask: 'more' }),
    makeEvent(780_000, { activity: 'reading' }),
  ];

  test('splits a session into station time from event timestamps', () => {
    expect(replay(session)).toEqual({
      reading: 60_000,
      editing: 30_000,
      bash: 60_000,
      idle: 600_000,   // turn end → waiting at the Pokémon Center until the prompt
      thinking: 30_000, // the prompt pulls it into thinking
    });
  });

  test('replaying the same events rebuilds the same totals', () => {
    expect(replay(session)).toEqual(replay(session));
  });

  test('the lifecycle timers never touch it', () => {
    const mgr = new AgentStateManager();
    mgr.processEvent(makeEvent(0, { activity: 'reading' }));
    mgr.checkIdleAgents(0);
    mgr.checkCompletedAgents(0);
    mgr.refreshAll();
    const agent = mgr.getAgent('sess-1')!;
    expect(agent.activityMs).toEqual({});
    expect(agent.segment).toEqual({ activity: 'reading', since: T0 });
  });

  test('resume hints are not evidence', () => {
    const mgr = new AgentStateManager();
    mgr.processEvent(makeEvent(0, { activity: 'reading' }));
    mgr.processEvent(makeEvent(100_000, { kind: 'task', isResumeHint: true, currentTask: 'x' }));
    expect(mgr.getAgent('sess-1')!.activityMs).toEqual({});
  });
});
