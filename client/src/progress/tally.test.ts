import { describe, expect, it } from 'bun:test';
import type { AgentState, LedgerEntry } from '../types/agent';
import { trainerFor } from '../naming/hero-names';
import { aggregate, diffProgress, foldSessions, trainerKey, type SessionTime } from './tally';
import { ITEM_MS } from './accrual';

const MIN = ITEM_MS;

function live(id: string, overrides: Partial<AgentState> = {}): AgentState {
  return {
    id, name: id, heroClass: 'warrior', heroColor: 'blue', status: 'active', currentActivity: 'reading',
    tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cost: 0, sessionStart: 0,
    toolCalls: [], errors: [], filesModified: [], lastEvent: 0, cwd: '/', configDir: '~/.claude',
    source: 'claude', activityMs: {}, segment: { activity: 'reading', since: 0 },
    ...overrides,
  };
}

function entry(id: string, activityMs: LedgerEntry['activityMs'], source: LedgerEntry['source'] = 'claude'): LedgerEntry {
  return { id, source, activityMs, lastSeen: 0 };
}

/** Two session ids that hash to different trainers. */
function distinctIds(): [string, string] {
  const a = 'session-a';
  for (let i = 0; ; i++) {
    const b = `session-b${i}`;
    if (trainerKey(b, 'claude') !== trainerKey(a, 'claude')) return [a, b];
  }
}

/** A second session id that hashes to the same trainer as `a`. */
function sameTrainerAs(a: string): string {
  for (let i = 0; ; i++) {
    const b = `twin-${i}`;
    if (trainerKey(b, 'claude') === trainerKey(a, 'claude')) return b;
  }
}

describe('foldSessions', () => {
  it('takes the larger of the ledger and the live projection, and never lowers it', () => {
    const sessions = new Map<string, SessionTime>();
    foldSessions(sessions, [entry('s', { reading: 2 * MIN })], [live('s')], 3 * MIN);
    expect(sessions.get('s')!.activityMs).toEqual({ reading: 3 * MIN });
    // The live segment closes short (the next event came sooner than projected):
    foldSessions(sessions, [entry('s', { reading: 2.5 * MIN })], [], 4 * MIN);
    expect(sessions.get('s')!.activityMs).toEqual({ reading: 3 * MIN });
  });
});

describe('aggregate', () => {
  it('floors items per session, then sums — the fleet is the sum of its trainers', () => {
    const [a, b] = distinctIds();
    const sessions = foldSessions(new Map(), [
      entry(a, { bash: 1.5 * MIN, idle: 3 * MIN }),
      entry(b, { bash: 1.5 * MIN }),
    ], [], 0);
    const t = aggregate(sessions);
    expect(t.global.items.bash).toBe(2);
    expect(t.global.items.idle).toBe(3);
    const perTrainer = [...t.byTrainer.values()].reduce((n, tr) => n + tr.items.bash, 0);
    expect(perTrainer).toBe(t.global.items.bash);
    expect(t.global.xp).toBe(6 * 60);
  });

  it('pools every session that has been the same trainer', () => {
    const a = 'session-a';
    const twin = sameTrainerAs(a);
    const t = aggregate(foldSessions(new Map(), [entry(a, { git: 2 * MIN }), entry(twin, { git: 3 * MIN })], [], 0));
    const tr = t.byTrainer.get(trainerKey(a, 'claude'))!;
    expect(tr.sessions).toBe(2);
    expect(tr.items.git).toBe(5);
    expect(tr.xp).toBe(300);
  });

  it('levels the partner from its party level, and evolves it there', () => {
    const id = 'session-a';
    const trainer = trainerFor(id, 'claude');
    const t = aggregate(foldSessions(new Map(), [entry(id, {})], [], 0));
    const tr = t.byTrainer.get(trainerKey(id, 'claude'))!;
    expect(tr.level).toBe(trainer.partnerLevel);
    expect(tr.species).toBe(trainer.partner);
  });
});

describe('diffProgress', () => {
  it('reports nothing on the first tally', () => {
    const t = aggregate(foldSessions(new Map(), [entry('s', { bash: 5 * MIN })], [], 0));
    expect(diffProgress(null, t, [live('s')])).toEqual([]);
  });

  it('reports nothing for a session seen for the first time', () => {
    const before = aggregate(new Map());
    const after = aggregate(foldSessions(new Map(), [entry('s', { bash: 5 * MIN })], [], 0));
    expect(diffProgress(before, after, [live('s')]).filter((e) => e.kind === 'earned')).toEqual([]);
  });

  it('reports each item a live agent just earned', () => {
    const sessions = foldSessions(new Map(), [entry('s', { bash: 0.9 * MIN })], [], 0);
    const before = aggregate(sessions);
    const after = aggregate(foldSessions(sessions, [entry('s', { bash: 1.1 * MIN })], [], 0));
    expect(diffProgress(before, after, [live('s')]).filter((e) => e.kind === 'earned'))
      .toEqual([{ kind: 'earned', agentId: 's', activity: 'bash', count: 1 }]);
  });

  it('reports a level-up', () => {
    const sessions = foldSessions(new Map(), [entry('s', {})], [], 0);
    const before = aggregate(sessions);
    const lv = before.byTrainer.get(trainerKey('s', 'claude'))!.level;
    const xpToNext = (lv + 1) ** 3 - lv ** 3;
    const after = aggregate(foldSessions(sessions, [entry('s', { reading: xpToNext * 1000 })], [], 0));
    expect(diffProgress(before, after, [live('s')])).toContainEqual({ kind: 'levelup', agentId: 's', level: lv + 1 });
  });
});
