import { describe, test, expect } from 'bun:test';
import { issueCounts, parseProject, parseProjectsResponse, authHeader } from './linear-client';

describe('issueCounts', () => {
  test('prefers Linear\'s computed history counts', () => {
    expect(issueCounts({
      issueCountHistory: [10, 17],
      completedIssueCountHistory: [3, 14],
      progress: 0.8235,
      scope: 17,
    })).toEqual({ completedIssues: 14, totalIssues: 17 });
  });

  test('falls back to progress × scope when history is empty', () => {
    // Young projects have empty history arrays but a live progress/scope pair.
    expect(issueCounts({
      issueCountHistory: [],
      completedIssueCountHistory: [],
      progress: 0.4,
      scope: 5,
    })).toEqual({ completedIssues: 2, totalIssues: 5 });
  });

  test('never reports more completed than total', () => {
    expect(issueCounts({ completedIssueCountHistory: [99], scope: 5 }))
      .toEqual({ completedIssues: 5, totalIssues: 5 });
  });

  test('reports zeroes for a project with nothing in it', () => {
    expect(issueCounts({})).toEqual({ completedIssues: 0, totalIssues: 0 });
  });
});

describe('parseProject', () => {
  const base = {
    id: 'proj-1',
    name: 'Village Expansion',
    state: 'started',
    color: '#5E6AD2',
    targetDate: '2026-09-30',
    url: 'https://linear.app/acme/project/village-expansion',
    progress: 0.5,
    scope: 4,
    issueCountHistory: [4],
    completedIssueCountHistory: [2],
  };

  test('normalizes a well-formed node', () => {
    expect(parseProject(base)).toEqual({
      id: 'proj-1',
      name: 'Village Expansion',
      state: 'started',
      progress: 0.5,
      completedIssues: 2,
      totalIssues: 4,
      color: '#5E6AD2',
      targetDate: '2026-09-30',
      url: 'https://linear.app/acme/project/village-expansion',
    });
  });

  test('excludes projects that are not in progress', () => {
    expect(parseProject({ ...base, state: 'completed' })).toBeNull();
    expect(parseProject({ ...base, state: 'canceled' })).toBeNull();
    expect(parseProject({ ...base, state: 'backlog' })).toBeNull();
  });

  test('keeps planned projects — a site can exist before ground is broken', () => {
    expect(parseProject({ ...base, state: 'planned' })?.state).toBe('planned');
  });

  test('returns null when required fields are missing', () => {
    expect(parseProject({ ...base, id: undefined })).toBeNull();
    expect(parseProject({ ...base, name: '' })).toBeNull();
  });

  test('clamps a progress value outside 0..1', () => {
    expect(parseProject({ ...base, progress: 1.4 })?.progress).toBe(1);
    expect(parseProject({ ...base, progress: -0.2 })?.progress).toBe(0);
  });

  test('tolerates missing optional fields', () => {
    const parsed = parseProject({ id: 'p', name: 'Bare', state: 'started' });
    expect(parsed).not.toBeNull();
    expect(parsed!.color).toBeUndefined();
    expect(parsed!.targetDate).toBeUndefined();
    expect(parsed!.progress).toBe(0);
    expect(parsed!.totalIssues).toBe(0);
    expect(parsed!.url).toBe('https://linear.app/project/p');
  });
});

describe('parseProjectsResponse', () => {
  function nodes(...ns: Array<Record<string, unknown>>) {
    return { data: { projects: { nodes: ns } } };
  }

  test('sorts closest-to-done first among unfinished projects', () => {
    const body = nodes(
      { id: 'a', name: 'Alpha', state: 'started', progress: 0.1, scope: 2 },
      { id: 'b', name: 'Beta', state: 'started', progress: 0.9, scope: 2 },
    );
    expect(parseProjectsResponse(body).map((p) => p.id)).toEqual(['b', 'a']);
  });

  test('sorts still-open 100% projects behind anything under construction', () => {
    // Otherwise these take every map plot and the yard is a row of finished
    // houses with nothing being built.
    const body = nodes(
      { id: 'done', name: 'Done But Open', state: 'started', progress: 1, scope: 5 },
      { id: 'wip', name: 'Barely Started', state: 'started', progress: 0.05, scope: 5 },
    );
    expect(parseProjectsResponse(body).map((p) => p.id)).toEqual(['wip', 'done']);
  });

  test('breaks ties by name', () => {
    const body = nodes(
      { id: 'z', name: 'Zeta', state: 'started', progress: 0.5, scope: 2 },
      { id: 'a', name: 'Alpha', state: 'started', progress: 0.5, scope: 2 },
    );
    expect(parseProjectsResponse(body).map((p) => p.id)).toEqual(['a', 'z']);
  });

  test('throws with the first GraphQL error message', () => {
    expect(() => parseProjectsResponse({ errors: [{ message: 'Access denied' }] }))
      .toThrow('Linear API error: Access denied');
  });

  test('returns an empty list for a malformed or empty body', () => {
    expect(parseProjectsResponse({})).toEqual([]);
    expect(parseProjectsResponse({ data: { projects: { nodes: 'nope' } } })).toEqual([]);
  });
});

describe('authHeader', () => {
  test('sends personal API keys bare and OAuth tokens with a Bearer prefix', () => {
    expect(authHeader('lin_api_abc123')).toBe('lin_api_abc123');
    expect(authHeader('lin_oauth_abc123')).toBe('Bearer lin_oauth_abc123');
  });
});
