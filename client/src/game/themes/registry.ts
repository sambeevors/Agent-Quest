import type { ThemeId, ThemeManifest } from './types';
import { sunnysideTheme } from './sunnyside';

const THEMES: Record<ThemeId, ThemeManifest> = {
  sunnyside: sunnysideTheme,
};

export function getActiveThemeId(): ThemeId {
  return 'sunnyside';
}

export function getActiveTheme(): ThemeManifest {
  return THEMES['sunnyside'];
}

/**
 * Scale values stored in a MapConfig (hero-scale, per-NPC scale) are absolute
 * numbers authored against the Tiny Swords art (192px hero frames, baseline
 * scale 0.5 — the shipped village.json says 0.4). Sunnyside heroes are ~15px
 * of drawing inside a 96x64 frame, so the same on-screen size needs 4x the
 * stored number. Rebasing here means no stored MapConfig has to migrate.
 */
const TINY_SWORDS_TO_SUNNYSIDE = 4;

export function rebaseSavedScale(savedScale: number): number {
  return savedScale * TINY_SWORDS_TO_SUNNYSIDE;
}
