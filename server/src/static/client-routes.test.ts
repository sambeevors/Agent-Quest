import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { registerClientRoutes } from './client-routes';

let dir: string;
let app: Hono;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aq-client-'));
  await mkdir(join(dir, 'assets', 'ui'), { recursive: true });
  await writeFile(join(dir, 'index.html'), '<html>village</html>');
  await writeFile(join(dir, 'assets', 'ui', 'box one.png'), 'png');
  await writeFile(join(tmpdir(), 'aq-outside.txt'), 'secret');
  app = new Hono();
  app.get('/api/health', (c) => c.json({ status: 'ok' }));
  registerClientRoutes(app, dir);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const get = (path: string) => app.fetch(new Request(`http://localhost${path}`));

describe('registerClientRoutes', () => {
  test('serves index.html at the root', async () => {
    const res = await get('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<html>village</html>');
    expect(res.headers.get('content-type')).toStartWith('text/html');
  });

  test('serves files with percent-encoded names', async () => {
    const res = await get('/assets/ui/box%20one.png');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('png');
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  test('a missing asset is a real 404, not the index page', async () => {
    expect((await get('/assets/ui/missing.png')).status).toBe(404);
  });

  test('API routes registered first still win', async () => {
    expect(await (await get('/api/health')).json()).toEqual({ status: 'ok' });
  });

  test('an unknown API path is not answered with the index page', async () => {
    expect((await get('/api/nope')).status).toBe(404);
  });

  test('refuses to escape the client directory', async () => {
    const res = await get('/..%2Faq-outside.txt');
    expect(await res.text()).not.toBe('secret');
  });
});
