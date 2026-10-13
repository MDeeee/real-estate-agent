import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import type { Env } from '../config/env.schema.js';
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  AdminSessionService,
  TOKEN_HEADER_FAILURES_PER_WINDOW,
} from './admin-session.service.js';

function serviceFor(token: string) {
  return new AdminSessionService({
    get: () => token,
  } as unknown as ConfigService<Env, true>);
}

const TOKEN = 'a-sufficiently-long-admin-token-0123';
const NOW = Date.UTC(2026, 9, 13, 12, 0, 0);

describe('AdminSessionService', () => {
  const service = serviceFor(TOKEN);

  describe('isAdminToken', () => {
    it('accepts exactly the configured token', () => {
      expect(service.isAdminToken(TOKEN)).toBe(true);
    });

    it.each([
      ['a different token', 'b-sufficiently-long-admin-token-0123'],
      ['a prefix', TOKEN.slice(0, -1)],
      ['empty', ''],
      ['a number', 42],
      ['undefined', undefined],
    ])('rejects %s', (_label, value) => {
      expect(service.isAdminToken(value)).toBe(false);
    });
  });

  describe('sessions', () => {
    it('accepts a fresh session until it expires', () => {
      const session = service.issueSession(NOW);

      expect(service.isValidSession(session, NOW)).toBe(true);
      expect(
        service.isValidSession(
          session,
          NOW + (ADMIN_SESSION_MAX_AGE_SECONDS - 1) * 1000,
        ),
      ).toBe(true);
      expect(
        service.isValidSession(
          session,
          NOW + (ADMIN_SESSION_MAX_AGE_SECONDS + 1) * 1000,
        ),
      ).toBe(false);
    });

    it('does not contain the admin token', () => {
      expect(service.issueSession(NOW)).not.toContain(TOKEN);
    });

    it('rejects a session whose expiry was extended', () => {
      const [expiry, signature] = service.issueSession(NOW).split('.');
      const forged = `${Number(expiry) + 86_400}.${signature}`;

      expect(service.isValidSession(forged, NOW)).toBe(false);
    });

    it('rejects a session signed with another token, so rotating ADMIN_TOKEN signs everyone out', () => {
      const session = serviceFor(
        'another-long-admin-token-0123456789-abc',
      ).issueSession(NOW);

      expect(service.isValidSession(session, NOW)).toBe(false);
    });

    it.each([
      ['not a string', 42],
      ['empty', ''],
      ['no signature', '1792000000'],
      ['no expiry', '.abc'],
      ['a non-numeric expiry', 'soon.abc'],
      ['extra parts', '1792000000.abc.def'],
    ])('rejects a value that is %s', (_label, value) => {
      expect(service.isValidSession(value, NOW)).toBe(false);
    });
  });

  describe('isAuthenticated (token header rate limit)', () => {
    function requestFrom(ip: string, token?: string, cookie?: string) {
      return {
        ip,
        cookies: cookie ? { [ADMIN_SESSION_COOKIE]: cookie } : {},
        header: (name: string) =>
          name.toLowerCase() === 'x-admin-token' ? token : undefined,
      } as unknown as Request;
    }

    function responseSpy() {
      const headers: Record<string, string> = {};
      const response = {
        setHeader: (name: string, value: string) => {
          headers[name] = value;
        },
      } as unknown as Response;
      return { response, headers };
    }

    function refusal(fn: () => unknown): HttpException {
      try {
        fn();
      } catch (error) {
        if (error instanceof HttpException) return error;
      }
      throw new Error('expected a 429');
    }

    it('answers 429 with Retry-After once an IP has presented too many wrong tokens', () => {
      const limited = serviceFor(TOKEN);
      const { response, headers } = responseSpy();
      const guess = requestFrom('203.0.113.1', 'wrong-token');

      for (let i = 0; i < TOKEN_HEADER_FAILURES_PER_WINDOW; i += 1) {
        expect(limited.isAuthenticated(guess, response, NOW)).toBe(false);
      }

      const error = refusal(() =>
        limited.isAuthenticated(guess, response, NOW),
      );
      expect(error.getStatus()).toBe(429);
      expect(error.getResponse()).toMatchObject({
        statusCode: 429,
        error: 'Too Many Requests',
      });
      expect(headers['Retry-After']).toBe('60');
      // Even the right token is refused until the window passes.
      const right = requestFrom('203.0.113.1', TOKEN);
      expect(() => limited.isAuthenticated(right, response, NOW)).toThrow(
        HttpException,
      );
      expect(limited.isAuthenticated(right, response, NOW + 60_001)).toBe(true);
    });

    it('counts each IP separately, and successful requests not at all', () => {
      const limited = serviceFor(TOKEN);
      const { response } = responseSpy();
      const guess = requestFrom('203.0.113.2', 'wrong-token');
      for (let i = 0; i < TOKEN_HEADER_FAILURES_PER_WINDOW; i += 1) {
        limited.isAuthenticated(guess, response, NOW);
      }

      const other = requestFrom('203.0.113.3', TOKEN);
      for (let i = 0; i < 20; i += 1) {
        expect(limited.isAuthenticated(other, response, NOW)).toBe(true);
      }
      expect(
        limited.isAuthenticated(
          requestFrom('203.0.113.3', 'nope'),
          response,
          NOW,
        ),
      ).toBe(false);
    });

    it('does not count requests without the header or with a valid session', () => {
      const limited = serviceFor(TOKEN);
      const { response } = responseSpy();
      const session = limited.issueSession(NOW);

      for (let i = 0; i < 20; i += 1) {
        expect(
          limited.isAuthenticated(requestFrom('203.0.113.4'), response, NOW),
        ).toBe(false);
        expect(
          limited.isAuthenticated(
            requestFrom('203.0.113.4', 'wrong-token', session),
            response,
            NOW,
          ),
        ).toBe(true);
      }
    });
  });
});
