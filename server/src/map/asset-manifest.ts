import type { AssetManifest } from './types';
import { buildAssetManifestSunnyside, buildBakedManifest } from './asset-manifest-sunnyside';

export type ThemeId = 'sunnyside' | 'pokemon';

/**
 * Returns the asset manifest the client consumes for a theme. Unknown `theme`
 * strings fall through to Sunnyside.
 *
 * The Pokémon bake (scripts/bake-pokemon/) emits the Sunnyside tree's exact
 * keys and sheet shapes, baked so every building renders at scale 1.
 */
export function buildAssetManifest(theme: ThemeId | string = 'sunnyside'): AssetManifest {
  if (theme === 'pokemon') return buildBakedManifest('/assets/themes/pokemon', () => 1);
  return buildAssetManifestSunnyside();
}
