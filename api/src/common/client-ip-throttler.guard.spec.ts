import { Controller, Get, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { afterEach, describe, expect, it } from 'vitest';
import { validateEnv } from '../config/env.schema.js';
import {
  CLIENT_IP_HEADER,
  ClientIpThrottlerGuard,
  INTERNAL_KEY_HEADER,
} from './client-ip-throttler.guard.js';

const INTERNAL_KEY = 'k'.repeat(32);
const LIMIT = 2;

@Controller('ping')
class PingController {
  @Get()
  ping(): { ok: true } {
    return { ok: true };
  }
}

describe('ClientIpThrottlerGuard', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
    // ConfigModule copies validated values into process.env; keep tests isolated.
    delete process.env['INTERNAL_API_KEY'];
  });

  async function start(internalKey: string | undefined): Promise<string> {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validate: () =>
            validateEnv({
              DATABASE_URL: 'postgresql://localhost/test',
              ADMIN_TOKEN: 'a-sufficiently-long-token',
              ...(internalKey && { INTERNAL_API_KEY: internalKey }),
            }),
        }),
        ThrottlerModule.forRoot({
          throttlers: [{ ttl: 60_000, limit: LIMIT }],
        }),
      ],
      controllers: [PingController],
      providers: [{ provide: APP_GUARD, useClass: ClientIpThrottlerGuard }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    return `${await app.getUrl()}/ping`;
  }

  async function hit(url: string, headers: Record<string, string> = {}) {
    return (await fetch(url, { headers })).status;
  }

  async function exhaust(url: string, headers: Record<string, string>) {
    const statuses: number[] = [];
    for (let i = 0; i < LIMIT + 1; i += 1) {
      statuses.push(await hit(url, headers));
    }
    return statuses;
  }

  it('keeps separate counters per forwarded client IP when the internal key is valid', async () => {
    const url = await start(INTERNAL_KEY);
    const asVisitor = (ip: string) => ({
      [INTERNAL_KEY_HEADER]: INTERNAL_KEY,
      [CLIENT_IP_HEADER]: ip,
    });

    expect(await exhaust(url, asVisitor('203.0.113.7'))).toEqual([
      200, 200, 429,
    ]);
    // A different visitor behind the same web server still has a full budget.
    expect(await exhaust(url, asVisitor('203.0.113.8'))).toEqual([
      200, 200, 429,
    ]);
    // The first visitor stays blocked.
    expect(await hit(url, asVisitor('203.0.113.7'))).toBe(429);
  });

  it('ignores x-client-ip without the internal key', async () => {
    const url = await start(INTERNAL_KEY);

    expect(await hit(url, { [CLIENT_IP_HEADER]: '203.0.113.7' })).toBe(200);
    expect(await hit(url, { [CLIENT_IP_HEADER]: '203.0.113.8' })).toBe(200);
    // Both requests were counted against the same (socket) address.
    expect(await hit(url, { [CLIENT_IP_HEADER]: '203.0.113.9' })).toBe(429);
  });

  it('ignores x-client-ip when the internal key is wrong', async () => {
    const url = await start(INTERNAL_KEY);
    const wrong = (ip: string) => ({
      [INTERNAL_KEY_HEADER]: 'x'.repeat(32),
      [CLIENT_IP_HEADER]: ip,
    });

    expect(await hit(url, wrong('203.0.113.7'))).toBe(200);
    expect(await hit(url, wrong('203.0.113.8'))).toBe(200);
    expect(await hit(url, wrong('203.0.113.9'))).toBe(429);
  });

  it('ignores both headers when no internal key is configured', async () => {
    const url = await start(undefined);
    const headers = (ip: string) => ({
      [INTERNAL_KEY_HEADER]: INTERNAL_KEY,
      [CLIENT_IP_HEADER]: ip,
    });

    expect(await hit(url, headers('203.0.113.7'))).toBe(200);
    expect(await hit(url, headers('203.0.113.8'))).toBe(200);
    expect(await hit(url, headers('203.0.113.9'))).toBe(429);
  });

  it('falls back to the socket address when the forwarded value is not an IP', async () => {
    const url = await start(INTERNAL_KEY);
    const headers = (value: string) => ({
      [INTERNAL_KEY_HEADER]: INTERNAL_KEY,
      [CLIENT_IP_HEADER]: value,
    });

    expect(await hit(url, headers('not-an-ip'))).toBe(200);
    expect(await hit(url, headers('also bad'))).toBe(200);
    expect(await hit(url, headers('203.0.113.9'))).toBe(200);
  });
});
