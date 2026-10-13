import {
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { tooManyRequests } from '../common/throttling.js';
import type { Env } from '../config/env.schema.js';

/** Header for scripts and curl; the web app uses the session cookie. */
export const ADMIN_TOKEN_HEADER = 'x-admin-token';
export const ADMIN_SESSION_COOKIE = 'admin_session';
/** Only the admin endpoints receive the cookie. */
export const ADMIN_SESSION_COOKIE_PATH = '/api/admin';
export const ADMIN_SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

/** Wrong `x-admin-token` values one client IP may present per window before it is refused. */
export const TOKEN_HEADER_FAILURES_PER_WINDOW = 5;
const TOKEN_HEADER_WINDOW_MS = 60_000;
/** Above this many tracked IPs, expired entries are dropped so the map cannot grow without bound. */
const MAX_TRACKED_IPS = 10_000;

interface FailureWindow {
  count: number;
  resetAt: number;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * Admin authentication. There is one shared secret, `ADMIN_TOKEN`.
 *
 * Logging in trades it for a signed, expiring session value, so the cookie
 * never holds the secret itself. The session needs no server-side storage:
 * its value is `<expiry>.<HMAC of the expiry>`. The HMAC key is derived from
 * `ADMIN_TOKEN` with HKDF and a random salt chosen at startup, so the secret
 * itself is never a signing key. Consequently, restarting the API (or changing
 * `ADMIN_TOKEN`) signs everyone out, and a copied cookie stays valid until it
 * expires or the API restarts: logging out only clears the browser's copy.
 *
 * The `x-admin-token` header (scripts, curl) is a second way to authenticate,
 * so guessing the token through it is rate-limited per client IP.
 */
@Injectable()
export class AdminSessionService {
  private readonly token: string;
  private readonly tokenDigest: Buffer;
  private readonly signingKey: Buffer;
  private readonly headerFailures = new Map<string, FailureWindow>();

  constructor(@Inject(ConfigService) config: ConfigService<Env, true>) {
    this.token = config.get('ADMIN_TOKEN', { infer: true });
    this.tokenDigest = digest(this.token);
    this.signingKey = Buffer.from(
      hkdfSync('sha256', this.token, randomBytes(32), 'admin-session-v1', 32),
    );
  }

  /** Constant-time comparison with the configured admin token. */
  isAdminToken(candidate: unknown): boolean {
    return (
      typeof candidate === 'string' &&
      timingSafeEqual(digest(candidate), this.tokenDigest)
    );
  }

  /** A new session value, valid for `ADMIN_SESSION_MAX_AGE_SECONDS`. */
  issueSession(now = Date.now()): string {
    const expiresAt = Math.floor(now / 1000) + ADMIN_SESSION_MAX_AGE_SECONDS;
    return `${expiresAt}.${this.sign(expiresAt)}`;
  }

  isValidSession(value: unknown, now = Date.now()): boolean {
    if (typeof value !== 'string') return false;
    const [expiry, signature, ...rest] = value.split('.');
    if (!expiry || !signature || rest.length > 0 || !/^\d+$/.test(expiry)) {
      return false;
    }
    const expiresAt = Number(expiry);
    const expected = Buffer.from(this.sign(expiresAt));
    const presented = Buffer.from(signature);
    return (
      presented.length === expected.length &&
      timingSafeEqual(presented, expected) &&
      expiresAt * 1000 > now
    );
  }

  /**
   * Whether the request carries a valid session cookie or admin token header.
   * Throws a 429 (with `Retry-After` on `response`) once this client IP has
   * presented too many wrong tokens; successful requests do not count.
   */
  isAuthenticated(
    request: Request,
    response: Response,
    now = Date.now(),
  ): boolean {
    const cookies = request.cookies as Record<string, unknown> | undefined;
    if (this.isValidSession(cookies?.[ADMIN_SESSION_COOKIE], now)) return true;

    const presented = request.header(ADMIN_TOKEN_HEADER);
    if (presented === undefined) return false;

    const client = request.ip ?? '';
    this.assertNotBlocked(client, response, now);
    if (this.isAdminToken(presented)) return true;
    this.recordFailure(client, now);
    return false;
  }

  private assertNotBlocked(client: string, response: Response, now: number) {
    const window = this.headerFailures.get(client);
    if (
      window &&
      window.resetAt > now &&
      window.count >= TOKEN_HEADER_FAILURES_PER_WINDOW
    ) {
      response.setHeader(
        'Retry-After',
        String(Math.max(1, Math.ceil((window.resetAt - now) / 1000))),
      );
      throw tooManyRequests();
    }
  }

  private recordFailure(client: string, now: number) {
    const window = this.headerFailures.get(client);
    if (window && window.resetAt > now) {
      window.count += 1;
      return;
    }
    if (this.headerFailures.size >= MAX_TRACKED_IPS) {
      for (const [ip, entry] of this.headerFailures) {
        if (entry.resetAt <= now) this.headerFailures.delete(ip);
      }
    }
    this.headerFailures.set(client, {
      count: 1,
      resetAt: now + TOKEN_HEADER_WINDOW_MS,
    });
  }

  private sign(expiresAt: number): string {
    return createHmac('sha256', this.signingKey)
      .update(`admin-session:${expiresAt}`)
      .digest('base64url');
  }
}
