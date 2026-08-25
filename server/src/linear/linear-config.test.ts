import { describe, test, expect } from 'bun:test';
import { LinearConfigStore, looksLikeLinearKey, keyHint } from './linear-config';

const VALID = 'lin_api_AbCdEf0123456789xyz';

describe('looksLikeLinearKey', () => {
  test('accepts personal and OAuth key shapes', () => {
    expect(looksLikeLinearKey(VALID)).toBe(true);
    expect(looksLikeLinearKey('lin_oauth_AbCdEf0123456789xyz')).toBe(true);
  });

  test('rejects the paste errors people actually make', () => {
    expect(looksLikeLinearKey('')).toBe(false);
    expect(looksLikeLinearKey('   ')).toBe(false);
    expect(looksLikeLinearKey('https://linear.app/settings/api')).toBe(false);
    expect(looksLikeLinearKey('lin_api_short')).toBe(false);
    expect(looksLikeLinearKey('sk-not-a-linear-key-at-all')).toBe(false);
    expect(looksLikeLinearKey(undefined)).toBe(false);
    expect(looksLikeLinearKey(12345)).toBe(false);
  });
});

describe('keyHint', () => {
  test('returns only the last 4 characters', () => {
    expect(keyHint('lin_api_abcdefgh')).toBe('efgh');
  });

  test('returns undefined rather than leaking a short key whole', () => {
    expect(keyHint(undefined)).toBeUndefined();
    expect(keyHint('abc')).toBeUndefined();
  });
});

describe('LinearConfigStore', () => {
  test('an env key wins and is reported as externally managed', async () => {
    const store = new LinearConfigStore('lin_api_fromtheenvironment123');
    await store.ready();

    expect(store.isEnvManaged).toBe(true);
    const resolved = store.resolve();
    expect(resolved.source).toBe('env');
    expect(resolved.apiKey).toBe('lin_api_fromtheenvironment123');
    expect(resolved.hint).toBe('t123');
  });

  test('treats a blank env var as unset', async () => {
    const store = new LinearConfigStore('   ');
    await store.ready();
    expect(store.isEnvManaged).toBe(false);
    expect(store.resolve().source).toBeNull();
  });

  test('refuses to save or clear while the environment manages the key', async () => {
    const store = new LinearConfigStore(VALID);
    await store.ready();

    // Otherwise a browser tab could silently override an operator's explicit
    // configuration, and the override would survive the next restart.
    await expect(store.save('lin_api_somethingelse0000')).rejects.toThrow('environment');
    await expect(store.clear()).rejects.toThrow('environment');
  });
});
