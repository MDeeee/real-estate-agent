import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import type { Env } from '../config/env.schema.js';
import { threadIdSchema } from './chat.schema.js';

export const CHAT_COOKIE = 'chat_thread';
/** Only the chat endpoints receive the cookie. */
export const CHAT_COOKIE_PATH = '/api/chat';
const CHAT_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The conversation id lives in an httpOnly cookie, never in page scripts: it
 * is a bearer secret (it unlocks the stored history), so a script on the page
 * must not be able to read it.
 */
@Injectable()
export class ChatThreadCookie {
  private readonly options: CookieOptions;

  constructor(@Inject(ConfigService) config: ConfigService<Env, true>) {
    this.options = {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.get('NODE_ENV', { infer: true }) === 'production',
      path: CHAT_COOKIE_PATH,
      maxAge: CHAT_COOKIE_MAX_AGE_MS,
    };
  }

  /** The request's conversation id; undefined when missing or not a UUID. */
  read(request: Request): string | undefined {
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const parsed = threadIdSchema.safeParse(cookies?.[CHAT_COOKIE]);
    return parsed.success ? parsed.data : undefined;
  }

  /** The request's conversation id, or a new one that the response stores. */
  resolve(request: Request, response: Response): string {
    return this.read(request) ?? this.rotate(response);
  }

  /** Starts a new conversation: a fresh id, stored by the response. */
  rotate(response: Response): string {
    const threadId = randomUUID();
    response.cookie(CHAT_COOKIE, threadId, this.options);
    return threadId;
  }
}
