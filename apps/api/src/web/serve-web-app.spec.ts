import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Controller, Get } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configureApp } from '../app.setup.js';
import { validateEnv } from '../config/env.schema.js';
import { isApiPath, resolveWebDistDir, serveWebApp } from './serve-web-app.js';

@Controller('ping')
class PingController {
  @Get()
  ping(): { ok: true } {
    return { ok: true };
  }
}

describe('serveWebApp', () => {
  let distDir: string;
  let app: NestExpressApplication | undefined;

  beforeEach(() => {
    distDir = mkdtempSync(join(tmpdir(), 'web-dist-'));
    mkdirSync(join(distDir, 'assets'));
    writeFileSync(join(distDir, 'index.html'), '<!doctype html><p>spa</p>');
    writeFileSync(join(distDir, 'icon.svg'), '<svg/>');
    writeFileSync(join(distDir, 'assets', 'index-abc123.js'), 'export {};');
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    rmSync(distDir, { recursive: true, force: true });
  });

  async function start(dir: string): Promise<{ url: string; served: boolean }> {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validate: () =>
            validateEnv({
              DATABASE_URL: 'postgresql://localhost/test',
              ADMIN_TOKEN: 'a-sufficiently-long-token-for-tests-0123',
            }),
        }),
      ],
      controllers: [PingController],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    const served = serveWebApp(app, dir);
    await app.listen(0, '127.0.0.1');
    return { url: await app.getUrl(), served };
  }

  it('serves index.html at / and for deep links, never cached', async () => {
    const { url } = await start(distDir);

    for (const path of ['/', '/admin', '/admin/login', '/some/deep/link']) {
      const response = await fetch(`${url}${path}`);
      expect(response.status, path).toBe(200);
      expect(await response.text()).toContain('<p>spa</p>');
      expect(response.headers.get('cache-control')).toBe('no-cache');
    }
  });

  it('caches hashed assets for a year and revalidates other files', async () => {
    const { url } = await start(distDir);

    const asset = await fetch(`${url}/assets/index-abc123.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    );

    const icon = await fetch(`${url}/icon.svg`);
    expect(icon.status).toBe(200);
    expect(icon.headers.get('cache-control')).toBe('no-cache');
  });

  it('answers 404, not the app, for a file that does not exist', async () => {
    const { url } = await start(distDir);

    expect((await fetch(`${url}/assets/old-hash.js`)).status).toBe(404);
  });

  it('leaves /api to the API, including unknown API paths', async () => {
    const { url } = await start(distDir);

    const ping = await fetch(`${url}/api/ping`);
    expect(await ping.json()).toEqual({ ok: true });
    expect(ping.headers.get('cache-control')).toBe('no-store');

    const unknown = await fetch(`${url}/api/nope`);
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get('content-type')).toContain('application/json');
  });

  it('treats /API and /Api like /api: the API answers, never index.html', async () => {
    const { url } = await start(distDir);

    for (const path of ['/API/ping', '/Api/ping']) {
      const ping = await fetch(`${url}${path}`);
      expect(ping.status, path).toBe(200);
      expect(await ping.json(), path).toEqual({ ok: true });
    }
    for (const path of ['/API/nope', '/Api', '/API/']) {
      const unknown = await fetch(`${url}${path}`);
      expect(unknown.status, path).toBe(404);
      expect(unknown.headers.get('content-type'), path).toContain(
        'application/json',
      );
    }
  });

  it('does not look API paths up among the static files', async () => {
    mkdirSync(join(distDir, 'api'));
    writeFileSync(join(distDir, 'api', 'ping'), 'a file, not the API');
    const { url } = await start(distDir);

    expect(await (await fetch(`${url}/api/ping`)).json()).toEqual({ ok: true });
    expect(await (await fetch(`${url}/API/ping`)).json()).toEqual({ ok: true });
  });

  it('does not answer non-GET page requests with the app', async () => {
    const { url } = await start(distDir);

    expect((await fetch(`${url}/admin`, { method: 'POST' })).status).toBe(404);
  });

  it('still starts the API when there is no web build', async () => {
    const { url, served } = await start(join(distDir, 'missing'));

    expect(served).toBe(false);
    expect((await fetch(`${url}/api/ping`)).status).toBe(200);
    expect((await fetch(`${url}/`)).status).toBe(404);
  });
});

describe('isApiPath', () => {
  it.each(['/api', '/api/', '/api/ping', '/API/ping', '/Api/x'])(
    'is true for %s',
    (path) => expect(isApiPath(path)).toBe(true),
  );

  it.each(['/', '/admin', '/apis', '/apiary/x', '/assets/api.js'])(
    'is false for %s',
    (path) => expect(isApiPath(path)).toBe(false),
  );
});

describe('resolveWebDistDir', () => {
  it('uses the configured directory, resolved to an absolute path', () => {
    expect(resolveWebDistDir('relative/dist')).toMatch(/relative[\\/]dist$/);
  });

  it('defaults to apps/web/dist', () => {
    expect(resolveWebDistDir(undefined)).toMatch(/web[\\/]dist$/);
  });
});
