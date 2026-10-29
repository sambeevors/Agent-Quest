import { describe, test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ledger, mergeMax, parseLedger, stationTime } from './ledger';
import { WORK_CAP_MS } from './station-time';
import type { AgentState } from '../types';

function agent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 'sess-1', name: 'n', heroClass: 'warrior', heroColor: 'blue', status: 'active',
    currentActivity: 'reading', tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    cost: 0, costKnown: true, sessionStart: 0, toolCalls: [], errors: [], filesModified: [],
    lastEvent: 1_000, cwd: '/p', configDir: '~/.claude', source: 'claude', isSubagent: false,
    activityMs: { reading: 60_000 }, segment: { activity: 'editing', since: 1_000 },
    ...overrides,
  };
}

function tmpPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'pokeagent-ledger-')), 'nested', 'ledger.json');
}

describe('stationTime', () => {
  test('adds the open segment, capped, for a live agent', () => {
    expect(stationTime(agent(), 31_000)).toEqual({ reading: 60_000, editing: 30_000 });
    expect(stationTime(agent(), 99 * 60_000)).toEqual({ reading: 60_000, editing: WORK_CAP_MS });
  });

  test('a finished session gets no open time', () => {
    expect(stationTime(agent({ status: 'completed' }), 31_000)).toEqual({ reading: 60_000 });
  });
});

describe('mergeMax', () => {
  test('keeps the larger figure per activity', () => {
    expect(mergeMax({ reading: 5, bash: 9 }, { reading: 7, bash: 3 })).toEqual({ reading: 7, bash: 9 });
  });

  test('returns null when nothing grew', () => {
    expect(mergeMax({ reading: 5 }, { reading: 5 })).toBeNull();
    expect(mergeMax({ reading: 5 }, {})).toBeNull();
  });
});

describe('Ledger', () => {
  test('recording the same session twice does not double it', () => {
    const ledger = new Ledger(tmpPath());
    expect(ledger.record([agent()], 31_000)).toHaveLength(1);
    expect(ledger.record([agent()], 31_000)).toHaveLength(0);
    expect(ledger.all()[0]!.activityMs).toEqual({ reading: 60_000, editing: 30_000 });
  });

  test('round-trips through disk', () => {
    const path = tmpPath();
    const a = new Ledger(path);
    a.record([agent()], 31_000);
    a.save();
    const b = new Ledger(path);
    b.load();
    expect(b.all()).toEqual(a.all());
  });

  test('a missing or corrupt file starts empty', () => {
    const missing = new Ledger(tmpPath());
    missing.load();
    expect(missing.all()).toEqual([]);

    const dir = mkdtempSync(join(tmpdir(), 'pokeagent-ledger-'));
    const path = join(dir, 'ledger.json');
    writeFileSync(path, '{not json');
    const corrupt = new Ledger(path);
    corrupt.load();
    expect(corrupt.all()).toEqual([]);
  });

  test('save is a no-op until something changed', () => {
    const path = tmpPath();
    const ledger = new Ledger(path);
    ledger.save();
    expect(() => readFileSync(path)).toThrow();
  });
});

describe('parseLedger', () => {
  test('drops malformed entries and fields', () => {
    const raw = JSON.stringify({
      entries: [
        { id: 'ok', source: 'codex', activityMs: { bash: 10, bogus: 5, idle: -1 }, lastSeen: 3 },
        { id: 7, source: 'claude', activityMs: {} },
        { id: 'bad-source', source: 'gemini', activityMs: {} },
      ],
    });
    expect(parseLedger(raw)).toEqual([{ id: 'ok', source: 'codex', activityMs: { bash: 10 }, lastSeen: 3 }]);
  });
});
