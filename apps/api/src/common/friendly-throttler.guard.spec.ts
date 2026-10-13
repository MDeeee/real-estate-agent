import { Controller, Get } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { afterEach, describe, expect, it } from 'vitest';
import { configureApp } from '../app.setup.js';
import { validateEnv } from '../config/env.schema.js';
import { FriendlyThrottlerGuard } from './friendly-throttler.guard.js';

const LIMIT = 2;

@Controller('ping')
class PingController {
  @Get()
  ping(): { ok: true } {
    return { ok: true };
  }
}

describe('FriendlyThrottlerGuard', () => {
  let app: NestExpressApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
    // ConfigModule copies validated values into process.env; keep tests isolated.
    delete process.env['TRUSTED_PROXY_HOPS'];
  });

  async function start(trustedProxyHops: number): Promise<string> {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validate: () =>
            validateEnv({
              DATABASE_URL: 'postgresql://localhost/test',
              ADMIN_TOKEN: 'a-sufficiently-long-token-for-tests-0123',
              TRUSTED_PROXY_HOPS: String(trustedProxyHops),
            }),
        }),
        ThrottlerModule.forRoot({
          throttlers: [{ ttl: 60_000, limit: LIMIT }],
        }),
      ],
      controllers: [PingController],
      providers: [{ provide: APP_GUARD, useClass: FriendlyThrottlerGuard }],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    return `${await app.getUrl()}/api/ping`;
  }

  async function hit(url: string, forwardedFor?: string) {
    const headers: Record<string, string> = forwardedFor
      ? { 'x-forwarded-for': forwardedFor }
      : {};
    return (await fetch(url, { headers })).status;
  }

  async function exhaust(url: string, forwardedFor?: string) {
    const statuses: number[] = [];
    for (let i = 0; i < LIMIT + 1; i += 1) {
      statuses.push(await hit(url, forwardedFor));
    }
    return statuses;
  }

  it('keeps separate counters per client IP behind a trusted proxy', async () => {
    const url = await start(1);

    expect(await exhaust(url, '203.0.113.7')).toEqual([200, 200, 429]);
    // A different visitor behind the same proxy still has a full budget.
    expect(await exhaust(url, '203.0.113.8')).toEqual([200, 200, 429]);
    // The first visitor stays blocked.
    expect(await hit(url, '203.0.113.7')).toBe(429);
  });

  it('takes the visitor from the right of X-Forwarded-For, never from the forgeable left', async () => {
    const url = await start(1);

    expect(await hit(url, '198.51.100.1, 203.0.113.7')).toBe(200);
    expect(await hit(url, '198.51.100.2, 203.0.113.7')).toBe(200);
    expect(await hit(url, '198.51.100.3, 203.0.113.7')).toBe(429);
  });

  it('ignores X-Forwarded-For when no proxy is trusted', async () => {
    const url = await start(0);

    expect(await hit(url, '203.0.113.7')).toBe(200);
    expect(await hit(url, '203.0.113.8')).toBe(200);
    // All three came from the same socket address.
    expect(await hit(url, '203.0.113.9')).toBe(429);
  });

  it('refuses with a friendly JSON message and a standard Retry-After header', async () => {
    const url = await start(0);
    await exhaust(url);
    const response = await fetch(url);

    expect(response.status).toBe(429);
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThanOrEqual(
      1,
    );
    const body = (await response.json()) as { message: string };
    expect(body.message).toBe(
      'Too many requests. Please wait a moment and try again.',
    );
    expect(body.message).not.toContain('ThrottlerException');
  });
});
