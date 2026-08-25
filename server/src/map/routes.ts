import type { Hono } from 'hono';
import { loadVillageMap } from './village-map';
import { buildAssetManifest } from './asset-manifest';

/**
 * The map surface is read-only. The client fetches the village once at boot,
 * plus the manifest telling it where each referenced texture lives.
 */
export function registerMapRoutes(app: Hono): void {
  app.get('/api/map', async (c) => {
    const map = await loadVillageMap();
    if (map === null) return c.body(null, 204);
    return c.json(map);
  });

  app.get('/api/assets/manifest', (c) => {
    const theme = c.req.query('theme') ?? 'tiny-swords-cc0';
    return c.json(buildAssetManifest(theme));
  });
}
