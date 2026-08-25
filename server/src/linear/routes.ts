import type { Hono } from 'hono';
import { LinearConfigStore, looksLikeLinearKey } from './linear-config';
import { fetchLinearProjects } from './linear-client';
import type { LinearProvider } from './linear-provider';

/**
 * HTTP surface for connecting Linear from the app instead of an env var.
 *
 * Two rules shape every handler here:
 *
 *   1. **The key is never returned.** Responses carry only a 4-character hint
 *      so a user can tell which key is active. A dashboard that echoes back a
 *      credential turns any XSS or shoulder-surf into a key leak.
 *   2. **A key is verified against the live API before it's persisted.** Saving
 *      first and failing on the next poll pushes the error somewhere the user
 *      isn't looking; verifying inline lets the form say "that key was
 *      rejected" while they still have it on their clipboard.
 */

export interface LinearRouteDeps {
  provider: LinearProvider;
  config: LinearConfigStore;
}

export function registerLinearRoutes(app: Hono, deps: LinearRouteDeps): void {
  const { provider, config } = deps;

  app.get('/api/linear', (c) => c.json(provider.getStatus()));

  app.put('/api/linear/key', async (c) => {
    if (config.isEnvManaged) {
      return c.json({
        error: 'LINEAR_API_KEY is set in the environment. Unset it to manage the key from the app.',
      }, 409);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Expected a JSON body of { "apiKey": "lin_api_…" }.' }, 400);
    }

    const apiKey = (body as { apiKey?: unknown } | null)?.apiKey;
    if (!looksLikeLinearKey(apiKey)) {
      return c.json({
        error: "That doesn't look like a Linear API key. Expected something starting with `lin_api_`.",
      }, 400);
    }
    const trimmed = apiKey.trim();

    // Verify before saving so a typo is reported here, not silently on the
    // next poll two minutes from now.
    try {
      await fetchLinearProjects({ apiKey: trimmed });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }

    await config.save(trimmed);
    const status = await provider.setKey({ ...config.resolve(), envManaged: false });
    return c.json(status);
  });

  app.delete('/api/linear/key', async (c) => {
    if (config.isEnvManaged) {
      return c.json({
        error: 'LINEAR_API_KEY is set in the environment. Unset it to manage the key from the app.',
      }, 409);
    }
    await config.clear();
    const status = await provider.setKey({ apiKey: undefined, source: null, hint: undefined, envManaged: false });
    return c.json(status);
  });
}
