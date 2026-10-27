import { describe, expect, test } from 'bun:test';
import { migrateLegacyKeys } from './legacy-keys';

function memoryStorage(entries: Record<string, string>): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    key: (i) => Array.from(map.keys())[i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
    clear: () => map.clear(),
  };
}

describe('migrateLegacyKeys', () => {
  test('moves both old prefixes onto pokeagent:', () => {
    const s = memoryStorage({ 'agentquest:settings': '{"a":1}', 'agent-quest:tutorial-seen': '1', other: 'x' });
    migrateLegacyKeys(s);
    expect(s.getItem('pokeagent:settings')).toBe('{"a":1}');
    expect(s.getItem('pokeagent:tutorial-seen')).toBe('1');
    expect(s.getItem('agentquest:settings')).toBeNull();
    expect(s.getItem('agent-quest:tutorial-seen')).toBeNull();
    expect(s.getItem('other')).toBe('x');
  });

  test('never overwrites a value already under the new name', () => {
    const s = memoryStorage({ 'agentquest:settings': 'old', 'pokeagent:settings': 'new' });
    migrateLegacyKeys(s);
    expect(s.getItem('pokeagent:settings')).toBe('new');
    expect(s.length).toBe(1);
  });
});
