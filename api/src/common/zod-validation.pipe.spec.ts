import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const pipe = new ZodValidationPipe(
  z.object({ page: z.coerce.number().int().min(1).default(1) }),
);

describe('ZodValidationPipe', () => {
  it('returns parsed and coerced data', () => {
    expect(pipe.transform({ page: '3' })).toEqual({ page: 3 });
    expect(pipe.transform({})).toEqual({ page: 1 });
  });

  it('throws a 400 with readable issues on invalid input', () => {
    try {
      pipe.transform({ page: '0' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const body = (error as BadRequestException).getResponse() as {
        message: string;
        issues: { path: string }[];
      };
      expect(body.message).toContain('page');
      expect(body.issues[0]?.path).toBe('page');
    }
  });
});
