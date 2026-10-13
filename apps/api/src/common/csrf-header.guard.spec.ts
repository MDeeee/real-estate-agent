import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CsrfHeaderGuard } from './csrf-header.guard.js';

function contextOf(method: string, headers: Record<string, string> = {}) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method,
        header: (name: string) => headers[name.toLowerCase()],
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('CsrfHeaderGuard', () => {
  const guard = new CsrfHeaderGuard();

  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'lets %s through without the header',
    (method) => {
      expect(guard.canActivate(contextOf(method))).toBe(true);
    },
  );

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'accepts %s with the header',
    (method) => {
      expect(
        guard.canActivate(contextOf(method, { 'x-requested-with': 'fetch' })),
      ).toBe(true);
    },
  );

  it.each([
    ['missing', {}],
    ['a different value', { 'x-requested-with': 'XMLHttpRequest' }],
    ['empty', { 'x-requested-with': '' }],
  ])('rejects POST when the header is %s', (_label, headers) => {
    expect(() => guard.canActivate(contextOf('POST', headers))).toThrow(
      ForbiddenException,
    );
  });
});
