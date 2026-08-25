import { describe, test, expect } from 'bun:test';
import {
  CHATTER_LINES,
  nextChatterDelay,
  pickChatterLine,
  type ChatterMood,
} from './hero-chatter';

const MOODS = Object.keys(CHATTER_LINES) as ChatterMood[];

/** Every activity the hero label can show needs its own pool. */
const ACTIVITIES = [
  'idle', 'thinking', 'reading', 'editing',
  'bash', 'git', 'debugging', 'reviewing',
] as const;

describe('CHATTER_LINES', () => {
  test('covers every activity plus the waiting and error states', () => {
    for (const activity of ACTIVITIES) expect(MOODS).toContain(activity);
    expect(MOODS).toContain('waiting');
    expect(MOODS).toContain('error');
  });

  test('gives each mood a dozen distinct lines', () => {
    for (const mood of MOODS) {
      const lines = CHATTER_LINES[mood];
      expect(lines.length).toBeGreaterThanOrEqual(12);
      expect(new Set(lines).size).toBe(lines.length);
    }
  });

  test('stays in the village, not in the terminal', () => {
    // The lines speak in the register of the building the hero walked to.
    // Naming the tooling instead is the failure mode this pool exists to
    // avoid — a bubble reading "exit code zero" is just the log again.
    const shoptalk = /\b(grep|commit|rebase|branch|PR|CI|cache|stack trace|exit code|undefined|null|compil\w*|refactor\w*|terminal|log line|repo|diff)\b/i;
    for (const mood of MOODS) {
      for (const line of CHATTER_LINES[mood]) {
        expect(line).not.toMatch(shoptalk);
      }
    }
  });

  test('keeps every line short enough for a two-line bubble', () => {
    for (const mood of MOODS) {
      for (const line of CHATTER_LINES[mood]) {
        expect(line.length).toBeLessThanOrEqual(34);
        expect(line.trim()).toBe(line);
      }
    }
  });
});

describe('pickChatterLine', () => {
  test('returns a line from the requested mood', () => {
    for (const mood of MOODS) {
      for (let i = 0; i < 50; i++) {
        const line = pickChatterLine(mood, null, () => i / 50);
        expect(CHATTER_LINES[mood]).toContain(line);
      }
    }
  });

  test('never repeats the previous line', () => {
    for (const mood of MOODS) {
      for (const previous of CHATTER_LINES[mood]) {
        for (let i = 0; i < 20; i++) {
          expect(pickChatterLine(mood, previous, () => i / 20)).not.toBe(previous);
        }
      }
    }
  });

  test('reaches the whole pool, including the last entry', () => {
    for (const mood of MOODS) {
      const seen = new Set<string>();
      const pool = CHATTER_LINES[mood];
      // Sweep [0, 1) finely enough to hit every bucket, and include the
      // degenerate random() === 1 that Math.floor would push out of range.
      for (let i = 0; i <= 1000; i++) seen.add(pickChatterLine(mood, null, () => i / 1000));
      expect(seen.size).toBe(pool.length);
    }
  });
});

describe('nextChatterDelay', () => {
  test('stays inside a several-second spread', () => {
    for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
      const delay = nextChatterDelay(() => r);
      expect(delay).toBeGreaterThanOrEqual(14000);
      expect(delay).toBeLessThanOrEqual(36000);
    }
  });

  test('varies with the draw, so heroes do not pop in unison', () => {
    expect(nextChatterDelay(() => 0)).not.toBe(nextChatterDelay(() => 0.9));
  });
});
