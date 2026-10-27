/**
 * Categorisation for asset-load failures, for BootScene's error screen.
 *
 * Categories are chosen to map to user intent: "did I break the trainers,
 * their Pokémon, or the town?" — which is far more actionable than a raw
 * list of 40 missing PNG paths.
 */

export interface AssetCategorySummary {
  /** Stable id used by callers that want to style categories differently. */
  id: 'trainer' | 'pokemon' | 'town' | 'ui' | 'other';
  /** Human-readable label for the boot screen. */
  label: string;
  count: number;
}

export interface GroupedMissingAssets {
  total: number;
  categories: AssetCategorySummary[];
  /** Relative paths (public-root-relative when possible) for sampling. */
  samples: string[];
}

/**
 * Strip the origin and leading slash from a loader URL so samples display
 * as `assets/pokemon/...` rather than `http://localhost:4445/assets/pokemon/...`.
 */
function normalisePath(raw: string): string {
  try {
    const u = new URL(raw);
    return u.pathname.replace(/^\//, '');
  } catch {
    return raw.replace(/^\//, '');
  }
}

function classify(path: string): AssetCategorySummary['id'] {
  const p = path.toLowerCase();
  if (p.includes('/trainers/') || p.includes('/portraits/')) return 'trainer';
  if (p.includes('/pokemon/pokemon/')) return 'pokemon';
  if (p.includes('/town/')) return 'town';
  if (p.includes('/ui/') || p.endsWith('logo.png')) return 'ui';
  return 'other';
}

const CATEGORY_ORDER: AssetCategorySummary['id'][] = [
  'trainer',
  'pokemon',
  'town',
  'ui',
  'other',
];

const CATEGORY_LABEL: Record<AssetCategorySummary['id'], string> = {
  trainer: 'Trainer sprites and portraits',
  pokemon: 'Pokémon icons',
  town: 'Cerulean City',
  ui: 'UI / logo',
  other: 'Other',
};

export function groupMissingByCategory(rawPaths: readonly string[]): GroupedMissingAssets {
  const normalised = rawPaths.map(normalisePath);
  const counts = new Map<AssetCategorySummary['id'], number>();
  for (const p of normalised) {
    const id = classify(p);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  // Preserve a consistent display order and drop empty buckets so the UI
  // only shows categories that were actually affected.
  const categories: AssetCategorySummary[] = CATEGORY_ORDER
    .filter((id) => (counts.get(id) ?? 0) > 0)
    .map((id) => ({ id, label: CATEGORY_LABEL[id], count: counts.get(id)! }));

  return {
    total: normalised.length,
    categories,
    samples: normalised,
  };
}
