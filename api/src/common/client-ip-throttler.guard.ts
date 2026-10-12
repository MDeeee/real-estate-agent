import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import {
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerLimitDetail,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import type { Env } from '../config/env.schema.js';
import {
  BUSY_MESSAGE,
  GLOBAL_TRACKER,
  TOO_MANY_REQUESTS_MESSAGE,
} from './throttling.js';

export const INTERNAL_KEY_HEADER = 'x-internal-key';
export const CLIENT_IP_HEADER = 'x-client-ip';

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Rate-limits per client IP. Server-side rendered pages reach the API from
 * the Next.js server, so every visitor would share that one address. A request
 * that proves it comes from our web server (shared `INTERNAL_API_KEY`) may name
 * the real visitor in `x-client-ip`; without the key that header is ignored.
 */
@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  private readonly internalKeyDigest: Buffer | undefined;

  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    @Inject(Reflector) reflector: Reflector,
    @Inject(ConfigService) config: ConfigService<Env, true>,
  ) {
    super(options, storageService, reflector);
    const key = config.get('INTERNAL_API_KEY', { infer: true });
    this.internalKeyDigest = key ? digest(key) : undefined;
  }

  /**
   * A 429 the visitor can act on: a friendly JSON message and the standard
   * `Retry-After` header (seconds), instead of the library's default text.
   */
  protected override throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const retryAfter = Math.max(
      1,
      Math.ceil(detail.timeToBlockExpire || detail.timeToExpire),
    );
    context
      .switchToHttp()
      .getResponse<{ setHeader(name: string, value: string): void }>()
      .setHeader('Retry-After', String(retryAfter));
    const message =
      detail.tracker === GLOBAL_TRACKER
        ? BUSY_MESSAGE
        : TOO_MANY_REQUESTS_MESSAGE;
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: 'Too Many Requests',
        message,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    return Promise.resolve(this.trackerFor(req));
  }

  private trackerFor(req: Record<string, unknown>): string {
    const ip = req['ip'];
    const fallback = typeof ip === 'string' ? ip : '';
    const headers = (req['headers'] ?? {}) as Record<
      string,
      string | string[] | undefined
    >;
    const forwarded = headerValue(headers, CLIENT_IP_HEADER)?.trim();
    if (!forwarded || !isIP(forwarded) || !this.hasValidInternalKey(headers)) {
      return fallback;
    }
    return forwarded;
  }

  private hasValidInternalKey(
    headers: Record<string, string | string[] | undefined>,
  ): boolean {
    if (!this.internalKeyDigest) return false;
    const presented = headerValue(headers, INTERNAL_KEY_HEADER);
    if (presented === undefined) return false;
    return timingSafeEqual(digest(presented), this.internalKeyDigest);
  }
}
