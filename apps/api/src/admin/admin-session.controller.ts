import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { z } from 'zod';
import { CsrfHeaderGuard } from '../common/csrf-header.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { Env } from '../config/env.schema.js';
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_COOKIE_PATH,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  AdminSessionService,
} from './admin-session.service.js';

/** Guessing the admin token must be slow: this many login attempts per IP per minute. */
export const LOGIN_ATTEMPTS_PER_MINUTE = 5;

const loginSchema = z.strictObject({ token: z.string().min(1).max(512) });
type LoginBody = z.infer<typeof loginSchema>;

export interface SessionStatus {
  authenticated: boolean;
}

@Controller('admin/session')
@UseGuards(CsrfHeaderGuard)
export class AdminSessionController {
  private readonly cookieOptions: CookieOptions;

  constructor(
    @Inject(AdminSessionService)
    private readonly sessions: AdminSessionService,
    @Inject(ConfigService) config: ConfigService<Env, true>,
  ) {
    this.cookieOptions = {
      httpOnly: true,
      sameSite: 'strict',
      secure: config.get('NODE_ENV', { infer: true }) === 'production',
      path: ADMIN_SESSION_COOKIE_PATH,
    };
  }

  /** Whether the caller is signed in. Answers 200 either way, so the page can ask without an error in the console. */
  @Get()
  status(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): SessionStatus {
    return { authenticated: this.sessions.isAuthenticated(request, response) };
  }

  @Post()
  @HttpCode(204)
  @Throttle({ default: { limit: LOGIN_ATTEMPTS_PER_MINUTE, ttl: 60_000 } })
  login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginBody,
    @Res({ passthrough: true }) response: Response,
  ): void {
    if (!this.sessions.isAdminToken(body.token)) {
      throw new UnauthorizedException('That token is not valid.');
    }
    response.cookie(ADMIN_SESSION_COOKIE, this.sessions.issueSession(), {
      ...this.cookieOptions,
      maxAge: ADMIN_SESSION_MAX_AGE_SECONDS * 1000,
    });
  }

  @Delete()
  @HttpCode(204)
  logout(@Res({ passthrough: true }) response: Response): void {
    response.clearCookie(ADMIN_SESSION_COOKIE, this.cookieOptions);
  }
}
