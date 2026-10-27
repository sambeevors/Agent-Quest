import type { AssetManifest } from './types';
import { buildAssetManifestSunnyside } from './asset-manifest-sunnyside';

export type ThemeId = 'sunnyside';

/**
 * Returns the asset manifest the client consumes. The project ships with a
 * single bundled theme; unknown `theme` strings fall through to the same
 * manifest.
 */
export function buildAssetManifest(_theme: ThemeId | string = 'sunnyside'): AssetManifest {
  return buildAssetManifestSunnyside();
}
