/**
 * The app was called Agent Quest, and its localStorage keys said so
 * (`agentquest:settings`, `agent-quest:tutorial-seen`, …). Move any of those
 * onto the `pokeagent:` prefix before anything reads them, so settings, panel
 * prefs and dismissed banners survive the rename. A key already present under
 * the new name wins.
 */
const LEGACY_PREFIXES = ['agentquest:', 'agent-quest:'];
const PREFIX = 'pokeagent:';

export function migrateLegacyKeys(storage: Storage): void {
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i))
    .filter((k): k is string => k !== null);
  for (const key of keys) {
    const legacy = LEGACY_PREFIXES.find((p) => key.startsWith(p));
    if (legacy === undefined) continue;
    const renamed = PREFIX + key.slice(legacy.length);
    const value = storage.getItem(key);
    if (value !== null && storage.getItem(renamed) === null) storage.setItem(renamed, value);
    storage.removeItem(key);
  }
}
