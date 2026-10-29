import { describe, expect, it } from 'bun:test';
import {
  IDLE_CAP_MS, ITEM_MS, WORK_CAP_MS,
  itemsFor, levelFor, levelProgress, liveActivityMs, mergeMax, openMs, xpFor,
} from './accrual';

describe('openMs', () => {
  it('caps a work segment and an idle one as the server does', () => {
    expect(openMs({ activity: 'reading', since: 0 }, 99 * 60_000)).toBe(WORK_CAP_MS);
    expect(openMs({ activity: 'idle', since: 0 }, 99 * 60_000)).toBe(IDLE_CAP_MS);
    expect(openMs({ activity: 'bash', since: 100 }, 0)).toBe(0);
  });
});

describe('liveActivityMs', () => {
  const agent = { status: 'active' as const, activityMs: { reading: 60_000 }, segment: { activity: 'bash' as const, since: 0 } };

  it('adds the open segment for a live agent', () => {
    expect(liveActivityMs(agent, 30_000)).toEqual({ reading: 60_000, bash: 30_000 });
  });

  it('leaves it out for a finished one', () => {
    expect(liveActivityMs({ ...agent, status: 'completed' }, 30_000)).toEqual({ reading: 60_000 });
  });

  it('copes with an older server that sends neither field', () => {
    expect(liveActivityMs({ status: 'active' }, 30_000)).toEqual({});
  });
});

describe('mergeMax', () => {
  it('never lowers a figure, and keeps identity when nothing grew', () => {
    const prev = { reading: 10, bash: 5 };
    expect(mergeMax(prev, { reading: 7 })).toBe(prev);
    expect(mergeMax(prev, { reading: 12 })).toEqual({ reading: 12, bash: 5 });
  });
});

describe('items and XP', () => {
  it('hands out one item per minute', () => {
    expect(itemsFor(ITEM_MS - 1)).toBe(0);
    expect(itemsFor(ITEM_MS)).toBe(1);
    expect(itemsFor(ITEM_MS * 7.9)).toBe(7);
  });

  it('gives one XP a second across every station', () => {
    expect(xpFor({ reading: 30_000, idle: 30_000, bash: 999 })).toBe(60);
  });
});

describe('levelFor', () => {
  it('starts at the partner’s level in its trainer’s party', () => {
    expect(levelFor(9, 0)).toBe(9);
  });

  it('follows the medium-fast curve, n³ experience at level n', () => {
    expect(levelFor(5, 216 - 125 - 1)).toBe(5);
    expect(levelFor(5, 216 - 125)).toBe(6);
    // Pidgey from Lv9 to Pidgeotto at 18: 18³ − 9³ = 5103 XP, about 85 minutes.
    expect(levelFor(9, 18 ** 3 - 9 ** 3)).toBe(18);
  });

  it('stops at 100', () => {
    expect(levelFor(99, 10 ** 9)).toBe(100);
  });
});

describe('levelProgress', () => {
  it('measures the way through the current level', () => {
    expect(levelProgress(5, 10)).toEqual({ level: 5, into: 10, needed: 216 - 125 });
    expect(levelProgress(100, 0)).toEqual({ level: 100, into: 0, needed: 0 });
  });
});
