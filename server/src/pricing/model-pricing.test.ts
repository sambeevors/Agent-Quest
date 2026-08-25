import { describe, test, expect } from 'bun:test';
import { rateFor, costFor } from './model-pricing';

/** Any instant safely after the Sonnet 5 introductory window closes. */
const AFTER_INTRO = Date.UTC(2026, 9, 1);
/** Any instant safely inside the Sonnet 5 introductory window. */
const DURING_INTRO = Date.UTC(2026, 5, 1);

describe('rateFor', () => {
  test('resolves each known family from its exact model id', () => {
    expect(rateFor('claude-fable-5', AFTER_INTRO)).toEqual({ input: 10, output: 50 });
    expect(rateFor('claude-opus-5', AFTER_INTRO)).toEqual({ input: 5, output: 25 });
    expect(rateFor('claude-sonnet-4-6', AFTER_INTRO)).toEqual({ input: 3, output: 15 });
    expect(rateFor('claude-haiku-4-5', AFTER_INTRO)).toEqual({ input: 1, output: 5 });
  });

  test('matches on family substring, so dated and Bedrock-style ids resolve', () => {
    expect(rateFor('claude-opus-4-6', AFTER_INTRO)).toEqual({ input: 5, output: 25 });
    expect(rateFor('us.anthropic.claude-opus-4-7-v1:0', AFTER_INTRO)).toEqual({ input: 5, output: 25 });
    expect(rateFor('claude-sonnet-4-20250514', AFTER_INTRO)).toEqual({ input: 3, output: 15 });
  });

  test('applies Sonnet 5 intro pricing only inside its window', () => {
    expect(rateFor('claude-sonnet-5', DURING_INTRO)).toEqual({ input: 2, output: 10 });
    expect(rateFor('claude-sonnet-5', AFTER_INTRO)).toEqual({ input: 3, output: 15 });
    // The promotion is Sonnet-5-specific — 4.6 bills the standard rate throughout.
    expect(rateFor('claude-sonnet-4-6', DURING_INTRO)).toEqual({ input: 3, output: 15 });
  });

  test('returns null for unknown, empty, and undefined model ids', () => {
    expect(rateFor(undefined, AFTER_INTRO)).toBeNull();
    expect(rateFor('', AFTER_INTRO)).toBeNull();
    expect(rateFor('gpt-5-codex', AFTER_INTRO)).toBeNull();
  });
});

describe('costFor', () => {
  test('prices each token bucket at its own multiplier', () => {
    // 1M input @ $5, 1M output @ $25, 1M cache read @ 0.1x input, 1M cache write @ 1.25x input.
    const cost = costFor(
      'claude-opus-5',
      { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 },
      AFTER_INTRO,
    );
    expect(cost).toBeCloseTo(5 + 25 + 0.5 + 6.25, 6);
  });

  test('scales linearly below a million tokens', () => {
    const cost = costFor('claude-haiku-4-5', { input: 500_000, output: 0, cacheRead: 0, cacheWrite: 0 }, AFTER_INTRO);
    expect(cost).toBeCloseTo(0.5, 6);
  });

  test('is zero — not null — for a known model with no tokens', () => {
    expect(costFor('claude-opus-5', { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, AFTER_INTRO)).toBe(0);
  });

  test('returns null for an unknown model rather than pricing it at zero', () => {
    expect(costFor(undefined, { input: 100, output: 100, cacheRead: 0, cacheWrite: 0 }, AFTER_INTRO)).toBeNull();
    expect(costFor('some-other-llm', { input: 100, output: 100, cacheRead: 0, cacheWrite: 0 }, AFTER_INTRO)).toBeNull();
  });
});
