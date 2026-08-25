import type { LinearProject } from '../types';

/**
 * Minimal read-only Linear GraphQL client.
 *
 * Scope is deliberately narrow: fetch in-progress projects and their issue
 * counts, nothing else. No SDK dependency — one query against one endpoint
 * doesn't justify pulling `@linear/sdk` and its transitive tree into a project
 * whose only other runtime dep is Hono.
 *
 * Auth is a personal API key (Linear → Settings → Security & access → API
 * keys), passed in the `Authorization` header verbatim. Linear personal keys
 * are sent WITHOUT a `Bearer` prefix; OAuth access tokens use one. We detect
 * which by prefix so both work.
 */

export const LINEAR_API_URL = 'https://api.linear.app/graphql';

/**
 * Projects whose state is one of these are treated as "under construction".
 * `completed`/`canceled` projects are excluded — a finished building is just a
 * building, and a canceled one shouldn't linger on the map.
 */
const IN_PROGRESS_STATES = new Set(['started', 'planned']);

const PROJECTS_QUERY = `
  query AgentQuestProjects {
    projects(first: 50, filter: { state: { in: ["started", "planned"] } }) {
      nodes {
        id
        name
        state
        color
        targetDate
        url
        progress
        scope
        issueCountHistory
        completedIssueCountHistory
      }
    }
  }
`;

interface RawProject {
  id?: unknown;
  name?: unknown;
  state?: unknown;
  color?: unknown;
  targetDate?: unknown;
  url?: unknown;
  progress?: unknown;
  scope?: unknown;
  issueCountHistory?: unknown;
  completedIssueCountHistory?: unknown;
}

interface GraphQlResponse {
  data?: { projects?: { nodes?: unknown } };
  errors?: Array<{ message?: unknown }>;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Last entry of one of Linear's history arrays — the current value. */
function latest(v: unknown): number | undefined {
  if (!Array.isArray(v) || v.length === 0) return undefined;
  return asNumber(v[v.length - 1]);
}

/**
 * Issue counts for a project.
 *
 * We do NOT fetch the issue list to count it ourselves: `projects × issues`
 * blows past Linear's query-complexity budget (a 50×250 fetch scores ~16k
 * against a 10k ceiling and is rejected outright with a 400). Linear already
 * publishes the numbers, so we read those instead.
 *
 * `completedIssueCountHistory` is the exact current count when Linear has
 * computed it, but it's empty for young projects — hence the fall back to
 * `progress × total`. That fallback is approximate on workspaces using
 * estimate-weighted progress, where `progress` isn't a plain issue ratio.
 */
export function issueCounts(raw: RawProject): { completedIssues: number; totalIssues: number } {
  const totalIssues = latest(raw.issueCountHistory) ?? asNumber(raw.scope) ?? 0;
  const completedIssues = latest(raw.completedIssueCountHistory)
    ?? Math.round((asNumber(raw.progress) ?? 0) * totalIssues);
  return {
    completedIssues: Math.max(0, Math.min(totalIssues, completedIssues)),
    totalIssues: Math.max(0, totalIssues),
  };
}

/** Normalize one raw GraphQL project node, or null when it's unusable. */
export function parseProject(raw: RawProject): LinearProject | null {
  const id = asString(raw.id);
  const name = asString(raw.name);
  const state = asString(raw.state);
  if (id === undefined || name === undefined || state === undefined) return null;
  if (!IN_PROGRESS_STATES.has(state)) return null;

  const { completedIssues, totalIssues } = issueCounts(raw);

  return {
    id,
    name,
    state,
    // Linear's own progress figure — it already honours the workspace's
    // estimate/canceled-issue rules, which a naive count here would not.
    progress: Math.max(0, Math.min(1, asNumber(raw.progress) ?? 0)),
    completedIssues,
    totalIssues,
    color: asString(raw.color),
    targetDate: asString(raw.targetDate),
    url: asString(raw.url) ?? `https://linear.app/project/${id}`,
  };
}

/** Parse a full GraphQL response body into projects, throwing on GraphQL errors. */
export function parseProjectsResponse(body: GraphQlResponse): LinearProject[] {
  if (Array.isArray(body.errors) && body.errors.length > 0) {
    const first = asString(body.errors[0]?.message) ?? 'unknown GraphQL error';
    throw new Error(`Linear API error: ${first}`);
  }
  const nodes = body.data?.projects?.nodes;
  if (!Array.isArray(nodes)) return [];

  const projects: LinearProject[] = [];
  for (const node of nodes) {
    if (typeof node !== 'object' || node === null) continue;
    const parsed = parseProject(node as RawProject);
    if (parsed !== null) projects.push(parsed);
  }
  // Sort so the map shows actual CONSTRUCTION. Projects still open at 100%
  // are common (the work is done, the project just hasn't been closed) — if
  // those led the list they'd take every plot and the yard would be a row of
  // finished houses. So unfinished projects come first, closest-to-done
  // leading, and the 100% stragglers sort to the back.
  projects.sort((a, b) => {
    const aDone = a.progress >= 1 ? 1 : 0;
    const bDone = b.progress >= 1 ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    return b.progress - a.progress || a.name.localeCompare(b.name);
  });
  return projects;
}

/** Linear personal API keys are sent bare; OAuth tokens need the Bearer prefix. */
export function authHeader(apiKey: string): string {
  return apiKey.startsWith('lin_oauth_') ? `Bearer ${apiKey}` : apiKey;
}

/**
 * Best-effort human-readable reason from an error response. Linear returns
 * `errors[0].extensions.userPresentableMessage` for input errors; falls back to
 * the plain GraphQL message, then to a truncated raw body.
 */
async function errorDetail(res: Response): Promise<string> {
  let body: string;
  try {
    body = await res.text();
  } catch {
    return 'no response body';
  }
  try {
    const parsed = JSON.parse(body) as GraphQlResponse & {
      errors?: Array<{ message?: unknown; extensions?: { userPresentableMessage?: unknown } }>;
    };
    const first = parsed.errors?.[0];
    const message = asString(first?.extensions?.userPresentableMessage) ?? asString(first?.message);
    if (message !== undefined) return message;
  } catch {
    // Not JSON — fall through to the raw body.
  }
  return body.length > 200 ? `${body.slice(0, 200)}…` : body;
}

export interface FetchProjectsOptions {
  apiKey: string;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Abort the request after this long. Default 10s. */
  timeoutMs?: number;
}

/** Fetch in-progress projects. Throws on network, auth, or GraphQL failure. */
export async function fetchLinearProjects(opts: FetchProjectsOptions): Promise<LinearProject[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(LINEAR_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader(opts.apiKey),
    },
    body: JSON.stringify({ query: PROJECTS_QUERY }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
  });

  if (!res.ok) {
    // 401/403 is by far the most likely failure and deserves a pointed message
    // — a generic "HTTP 401" sends people hunting through server logs.
    if (res.status === 401 || res.status === 403) {
      throw new Error('Linear rejected the API key (401/403). Check the key and reconnect.');
    }
    // Linear puts the real reason in the body even on a 4xx (query complexity,
    // bad filter, …). Reporting only the status code hides the one detail that
    // would let anyone fix it, so pull the message out when it's there.
    throw new Error(`Linear API returned HTTP ${res.status}: ${await errorDetail(res)}`);
  }

  return parseProjectsResponse((await res.json()) as GraphQlResponse);
}
