/**
 * Dollar pricing for Claude models, in USD per million tokens.
 *
 * Upstream deliberately reported token COUNTS only, on the grounds that
 * pricing drifts with every model generation. That reasoning is sound, so the
 * table below is built to be cheap to maintain rather than exhaustive:
 *
 *   - Rates are keyed by model FAMILY (a substring of the model id), not by
 *     exact id, so `claude-opus-5`, `claude-opus-4-8` and a Bedrock-style
 *     `us.anthropic.claude-opus-4-7-v1:0` all resolve without new entries.
 *   - An unknown family returns `null` rather than 0. Callers must treat that
 *     as "cost unknown" and say so in the UI — silently pricing an unknown
 *     model at zero is how a dashboard ends up lying about spend.
 *
 * Cache multipliers follow the published ratios: cache READS bill at 0.1x the
 * input rate, cache WRITES at 1.25x (the 5-minute TTL). The JSONL reports a
 * single `cache_creation_input_tokens` bucket with no TTL breakdown, so 1h-TTL
 * writes (2x) are under-counted.
 */

export interface ModelRate {
  /** USD per million uncached input tokens. */
  input: number;
  /** USD per million output tokens. */
  output: number;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Cache reads bill at 0.1x the model's input rate. */
export const CACHE_READ_MULTIPLIER = 0.1;
/** Cache writes bill at 1.25x the input rate for the default 5-minute TTL. */
export const CACHE_WRITE_MULTIPLIER = 1.25;

/**
 * Family substrings checked in order, so more specific keys must come first
 * (`opus-4-6` before `opus`). Matching is done on the lowercased model id.
 */
interface FamilyRate extends ModelRate {
  /** Substring matched against the lowercased model id. */
  key: string;
}

const FAMILY_RATES: readonly FamilyRate[] = [
  // Fable / Mythos tier.
  { key: 'fable',  input: 10, output: 50 },
  { key: 'mythos', input: 10, output: 50 },
  // Opus tier — 5, 4.8, 4.7 and 4.6 all price identically.
  { key: 'opus',   input: 5,  output: 25 },
  // Sonnet tier. Sonnet 5 has promotional pricing (see SONNET_5_INTRO below);
  // this is the standard rate every other Sonnet bills at.
  { key: 'sonnet', input: 3,  output: 15 },
  // Haiku tier.
  { key: 'haiku',  input: 1,  output: 5 },
];

/**
 * Sonnet 5 launched with introductory pricing that expires at the end of
 * 2026-08-31 UTC, after which it reverts to the standard Sonnet rate. Encoded
 * with its expiry so the table doesn't quietly over-report spend the day the
 * promotion lapses.
 */
const SONNET_5_INTRO = {
  rate: { input: 2, output: 10 } satisfies ModelRate,
  /** First instant at which intro pricing no longer applies (2026-09-01T00:00:00Z). */
  expiresAt: Date.UTC(2026, 8, 1),
};

/**
 * Look up the per-million-token rate for a model id. Returns null when the id
 * is absent or belongs to a family this table doesn't know, which callers must
 * propagate as "unknown" rather than zero.
 *
 * `now` is injectable so the Sonnet 5 intro-pricing boundary is testable.
 */
export function rateFor(model: string | undefined, now: number = Date.now()): ModelRate | null {
  if (model === undefined || model.length === 0) return null;
  const id = model.toLowerCase();

  if (id.includes('sonnet') && id.includes('-5') && now < SONNET_5_INTRO.expiresAt) {
    return SONNET_5_INTRO.rate;
  }

  for (const family of FAMILY_RATES) {
    if (id.includes(family.key)) return { input: family.input, output: family.output };
  }
  return null;
}

/**
 * Cost in USD for one usage record on a given model. Returns null when the
 * model is unknown — the caller decides whether that makes the whole session's
 * cost unknown or merely partial.
 */
export function costFor(
  model: string | undefined,
  usage: TokenUsage,
  now: number = Date.now(),
): number | null {
  const rate = rateFor(model, now);
  if (rate === null) return null;

  const perToken = (perMillion: number): number => perMillion / 1_000_000;
  return (
    usage.input * perToken(rate.input) +
    usage.output * perToken(rate.output) +
    usage.cacheRead * perToken(rate.input) * CACHE_READ_MULTIPLIER +
    usage.cacheWrite * perToken(rate.input) * CACHE_WRITE_MULTIPLIER
  );
}
