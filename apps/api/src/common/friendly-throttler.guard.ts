import { type ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import {
  BUSY_MESSAGE,
  GLOBAL_TRACKER,
  TOO_MANY_REQUESTS_MESSAGE,
  tooManyRequests,
} from './throttling.js';

/**
 * Rate-limits per client IP (`request.ip`, which honours `TRUSTED_PROXY_HOPS`
 * through Express `trust proxy`) and answers a refusal with something the
 * visitor can act on: a friendly JSON message and the standard `Retry-After`
 * header (seconds), instead of the library's default text.
 */
@Injectable()
export class FriendlyThrottlerGuard extends ThrottlerGuard {
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
    throw tooManyRequests(message);
  }
}
