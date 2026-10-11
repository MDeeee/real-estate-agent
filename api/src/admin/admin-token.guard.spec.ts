import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import type { Env } from '../config/env.schema.js';
import { AdminTokenGuard } from './admin-token.guard.js';

const TOKEN = 'a-sufficiently-long-admin-token';

const config = {
  get: () => TOKEN,
} as unknown as ConfigService<Env, true>;

function contextWith(headers: Record<string, string | undefined>) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        header: (name: string) => headers[name.toLowerCase()],
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('AdminTokenGuard', () => {
  const guard = new AdminTokenGuard(config);

  it('allows a request carrying the configured token', () => {
    expect(guard.canActivate(contextWith({ 'x-admin-token': TOKEN }))).toBe(
      true,
    );
  });

  it.each([
    ['a missing header', undefined],
    ['an empty token', ''],
    ['a wrong token of the same length', 'b-sufficiently-long-admin-token'],
    ['a token that is a prefix of the real one', TOKEN.slice(0, -1)],
    ['a longer token', `${TOKEN}-extra`],
  ])('rejects %s', (_label, value) => {
    expect(() =>
      guard.canActivate(contextWith({ 'x-admin-token': value })),
    ).toThrow(UnauthorizedException);
  });
});
