import { type ExecutionContext, SetMetadata } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import type { Env } from '../config/env.schema.js';

export const CHAT_THROTTLE_NAME = 'chat';
export const CHAT_GLOBAL_THROTTLE_NAME = 'chat-global';
/** Tracker of the global chat budget: one shared counter for every visitor. */
export const GLOBAL_TRACKER = '*global*';
const CHAT_GLOBAL_TTL_MS = 60_000;
const CHAT_THROTTLED_KEY = 'chat-throttled';

/** Marks a route handler as costing LLM tokens: it also counts against the chat budgets. */
export const ChatThrottled = () => SetMetadata(CHAT_THROTTLED_KEY, true);

const reflector = new Reflector();

function isChatThrottled(context: ExecutionContext): boolean {
  return (
    reflector.get<boolean | undefined>(
      CHAT_THROTTLED_KEY,
      context.getHandler(),
    ) === true
  );
}

export const BUSY_MESSAGE =
  'The assistant is busy, please try again in a minute.';
export const TOO_MANY_REQUESTS_MESSAGE =
  'Too many requests. Please wait a moment and try again.';

export function buildThrottlerOptions(
  config: ConfigService<Env, true>,
): ThrottlerModuleOptions {
  const ttl = config.get('THROTTLE_TTL_SECONDS', { infer: true }) * 1000;
  return {
    throttlers: [
      { ttl, limit: config.get('THROTTLE_LIMIT', { infer: true }) },
      {
        name: CHAT_THROTTLE_NAME,
        ttl,
        limit: config.get('CHAT_THROTTLE_LIMIT', { infer: true }),
        skipIf: (context) => !isChatThrottled(context),
      },
      {
        // Last on purpose: a request already refused for its own IP must not
        // spend the shared budget.
        name: CHAT_GLOBAL_THROTTLE_NAME,
        ttl: CHAT_GLOBAL_TTL_MS,
        limit: config.get('CHAT_GLOBAL_LIMIT_PER_MINUTE', { infer: true }),
        getTracker: () => GLOBAL_TRACKER,
        skipIf: (context) => !isChatThrottled(context),
      },
    ],
  };
}
