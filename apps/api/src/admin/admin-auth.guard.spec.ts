import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import type { Env } from '../config/env.schema.js';
import { AdminAuthGuard } from './admin-auth.guard.js';
import {
  ADMIN_SESSION_COOKIE,
  AdminSessionService,
} from './admin-session.service.js';

const TOKEN = 'a-sufficiently-long-admin-token-0123';

const config = {
  get: () => TOKEN,
} as unknown as ConfigService<Env, true>;

const sessions = new AdminSessionService(config);
const guard = new AdminAuthGuard(sessions);

function contextWith(
  headers: Record<string, string | undefined> = {},
  cookies: Record<string, string> = {},
) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        cookies,
        ip: '198.51.100.7',
        header: (name: string) => headers[name.toLowerCase()],
      }),
      getResponse: () => ({ setHeader: () => undefined }),
    }),
  } as unknown as ExecutionContext;
}

describe('AdminAuthGuard', () => {
  it('allows a request carrying the configured token (scripts, curl)', () => {
    expect(guard.canActivate(contextWith({ 'x-admin-token': TOKEN }))).toBe(
      true,
    );
  });

  it('allows a request carrying a valid session cookie', () => {
    const cookie = { [ADMIN_SESSION_COOKIE]: sessions.issueSession() };
    expect(guard.canActivate(contextWith({}, cookie))).toBe(true);
  });

  it.each([
    ['a missing header', undefined],
    ['an empty token', ''],
    [
      'a wrong token of the same length',
      'b-sufficiently-long-admin-token-0123',
    ],
    ['a token that is a prefix of the real one', TOKEN.slice(0, -1)],
    ['a longer token', `${TOKEN}-extra`],
  ])('rejects %s', (_label, value) => {
    expect(() =>
      guard.canActivate(contextWith({ 'x-admin-token': value })),
    ).toThrow(UnauthorizedException);
  });

  it('rejects the admin token presented as a cookie value', () => {
    expect(() =>
      guard.canActivate(contextWith({}, { [ADMIN_SESSION_COOKIE]: TOKEN })),
    ).toThrow(UnauthorizedException);
  });
});
