import { describe, test, expect } from 'bun:test';
import { LinearProvider, type KeyState } from './linear-provider';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const ONE_PROJECT = {
  data: {
    projects: {
      nodes: [
        { id: 'p1', name: 'Keep', state: 'started', progress: 0.5, scope: 2, issueCountHistory: [2], completedIssueCountHistory: [1] },
      ],
    },
  },
};

const STORED_KEY: KeyState = { apiKey: 'lin_api_test', source: 'stored', hint: 'test', envManaged: false };
const NO_KEY: KeyState = { apiKey: undefined, source: null, hint: undefined, envManaged: false };

function providerWith(fetchImpl: () => Promise<Response>, onStatus?: (s: unknown) => void) {
  return new LinearProvider({
    fetchImpl: fetchImpl as unknown as typeof fetch,
    onStatus: onStatus as never,
  });
}

describe('LinearProvider', () => {
  test('stays dormant and reports disconnected with no key configured', async () => {
    let called = false;
    const provider = providerWith(async () => { called = true; return jsonResponse(ONE_PROJECT); });
    await provider.start();

    expect(provider.enabled).toBe(false);
    expect(called).toBe(false);
    const status = provider.getStatus();
    expect(status.connected).toBe(false);
    expect(status.keySource).toBeNull();
    expect(status.projects).toEqual([]);
    provider.stop();
  });

  test('syncs once a key is set at runtime, without a restart', async () => {
    const provider = providerWith(async () => jsonResponse(ONE_PROJECT));
    const status = await provider.setKey(STORED_KEY);

    expect(status.connected).toBe(true);
    expect(status.keySource).toBe('stored');
    expect(status.keyHint).toBe('test');
    expect(status.error).toBeUndefined();
    expect(status.projects).toHaveLength(1);
    expect(status.projects[0]!.progress).toBe(0.5);
    provider.stop();
  });

  test('never exposes the key itself in the status', async () => {
    const provider = providerWith(async () => jsonResponse(ONE_PROJECT));
    const status = await provider.setKey(STORED_KEY);
    expect(JSON.stringify(status)).not.toContain('lin_api_test');
    provider.stop();
  });

  test('clearing the key drops the projects — stale sites are worse than none', async () => {
    const provider = providerWith(async () => jsonResponse(ONE_PROJECT));
    await provider.setKey(STORED_KEY);
    expect(provider.getStatus().projects).toHaveLength(1);

    const status = await provider.setKey(NO_KEY);
    expect(status.connected).toBe(false);
    expect(status.projects).toEqual([]);
    expect(status.lastSyncedAt).toBeNull();
  });

  test('keeps the last good projects when a later poll fails', async () => {
    let calls = 0;
    const provider = providerWith(async () => {
      calls++;
      return calls === 1 ? jsonResponse(ONE_PROJECT) : jsonResponse({}, 500);
    });

    await provider.setKey(STORED_KEY);
    const afterFailure = await provider.poll();

    expect(afterFailure.error).toContain('500');
    // The site stays on the map through a transient failure.
    expect(afterFailure.projects).toHaveLength(1);
    provider.stop();
  });

  test('surfaces a pointed message when the key is rejected', async () => {
    const provider = providerWith(async () => jsonResponse({}, 401));
    const status = await provider.setKey(STORED_KEY);
    expect(status.error).toContain('rejected the API key');
    provider.stop();
  });

  test('reports an env-managed key so the UI can hide its controls', async () => {
    const provider = providerWith(async () => jsonResponse(ONE_PROJECT));
    const status = await provider.setKey({
      apiKey: 'lin_api_fromenv', source: 'env', hint: 'kenv', envManaged: true,
    });
    expect(status.envManaged).toBe(true);
    expect(status.keySource).toBe('env');
    provider.stop();
  });

  test('notifies the subscriber on every poll and key change', async () => {
    const seen: number[] = [];
    const provider = providerWith(
      async () => jsonResponse(ONE_PROJECT),
      (s) => seen.push((s as { projects: unknown[] }).projects.length),
    );
    await provider.setKey(STORED_KEY);
    await provider.poll();
    await provider.setKey(NO_KEY);
    expect(seen).toEqual([1, 1, 0]);
  });
});
