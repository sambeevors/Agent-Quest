import type { ThemeId, ThemeManifest } from './types';
import { sunnysideTheme } from './sunnyside';
import { pokemonTheme } from './pokemon';

const THEMES: Record<ThemeId, ThemeManifest> = {
  sunnyside: sunnysideTheme,
  pokemon: pokemonTheme,
};

/** Shipped when nothing asks for another. */
const DEFAULT_THEME: ThemeId = 'pokemon';
const STORAGE_KEY = 'agent-quest:theme';

function isThemeId(value: string | null): value is ThemeId {
  return value !== null && value in THEMES;
}

/**
 * The theme is fixed for the life of the page — Phaser bakes textures at boot
 * and React reads portraits from it — so it is resolved once: `?theme=` in the
 * URL wins (and is remembered), then the remembered choice, then the default.
 */
function resolveThemeId(): ThemeId {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  const fromUrl = new URLSearchParams(window.location.search).get('theme');
  if (isThemeId(fromUrl)) {
    try { window.localStorage.setItem(STORAGE_KEY, fromUrl); } catch { /* storage unavailable */ }
    return fromUrl;
  }
  let stored: string | null = null;
  try { stored = window.localStorage.getItem(STORAGE_KEY); } catch { /* storage unavailable */ }
  return isThemeId(stored) ? stored : DEFAULT_THEME;
}

const ACTIVE: ThemeId = resolveThemeId();

export function getActiveThemeId(): ThemeId {
  return ACTIVE;
}

export function getActiveTheme(): ThemeManifest {
  return THEMES[ACTIVE];
}

/**
 * Scale values stored in a MapConfig (hero-scale, per-NPC scale) are absolute
 * numbers authored against the Tiny Swords art (192px hero frames, baseline
 * scale 0.5 — the shipped village.json says 0.4). Each theme carries the
 * factor that turns one into its own sprites' scale (Sunnyside heroes are
 * ~15px of drawing inside a 96x64 frame, so x4), so no stored MapConfig has
 * to migrate.
 */
export function rebaseSavedScale(savedScale: number): number {
  return savedScale * getActiveTheme().savedScaleFactor;
}

/** A building's display name: the theme's, when it renames one. */
export function buildingLabel(def: { id: string; label: string }): string {
  return getActiveTheme().getBuildingLabel?.(def.id) ?? def.label;
}
