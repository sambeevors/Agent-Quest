import { resolve, sep } from 'node:path';
import type { Hono } from 'hono';
import { getMimeType } from 'hono/utils/mime';

/**
 * Serves the built client (`client/dist`) from the API server, so a single
 * process on :4444 is the whole app. The desktop shell relies on this — it
 * has no Vite dev server — and loading the UI from the API's own origin means
 * `config.ts` resolves the server to itself with no build-time URL baked in.
 *
 * Opt-in via `AGENT_QUEST_CLIENT_DIR`; `bun start` keeps using Vite on :4445.
 *
 * A missing `/assets/...` file is a real 404 rather than the index page, for
 * the same reason `strictAssets404` exists in the Vite config: Phaser would
 * otherwise accept HTML as a loaded texture and render a map without tiles.
 *
 * Content-Type is set explicitly: a `bun build --compile` binary serves
 * `Bun.file` responses with no MIME type, and the browser refuses to run a
 * module script without one.
 */
export function registerClientRoutes(app: Hono, clientDir: string): void {
  const root = resolve(clientDir);
  const index = resolve(root, 'index.html');

  app.get('*', async (c) => {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(c.req.url).pathname);
    } catch {
      return c.body(null, 400);
    }
    if (pathname.startsWith('/api/')) return c.notFound();

    const target = resolve(root, `.${pathname}`);
    // Refuse anything that resolves outside the client directory (`..`).
    if (target !== root && !target.startsWith(root + sep)) return c.body(null, 404);

    const file = Bun.file(target);
    if (pathname !== '/' && (await file.exists())) return serve(target);
    if (pathname.startsWith('/assets/')) return c.body(null, 404);
    return serve(index);
  });
}

function serve(path: string): Response {
  const type = getMimeType(path) ?? 'application/octet-stream';
  return new Response(Bun.file(path), { headers: { 'Content-Type': type } });
}
