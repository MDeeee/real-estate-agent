import { createHash, timingSafeEqual } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Env } from '../config/env.schema.js';

export const ADMIN_TOKEN_HEADER = 'x-admin-token';

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

@Injectable()
export class AdminTokenGuard implements CanActivate {
  private readonly expected: Buffer;

  constructor(@Inject(ConfigService) config: ConfigService<Env, true>) {
    this.expected = digest(config.get('ADMIN_TOKEN', { infer: true }));
  }

  canActivate(context: ExecutionContext): boolean {
    const provided = context
      .switchToHttp()
      .getRequest<Request>()
      .header(ADMIN_TOKEN_HEADER);
    if (
      typeof provided !== 'string' ||
      !timingSafeEqual(digest(provided), this.expected)
    ) {
      throw new UnauthorizedException('Invalid or missing admin token.');
    }
    return true;
  }
}
