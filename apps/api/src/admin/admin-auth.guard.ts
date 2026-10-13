import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AdminSessionService } from './admin-session.service.js';

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    @Inject(AdminSessionService)
    private readonly sessions: AdminSessionService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    if (
      !this.sessions.isAuthenticated(
        http.getRequest<Request>(),
        http.getResponse<Response>(),
      )
    ) {
      throw new UnauthorizedException('Sign in as admin to continue.');
    }
    return true;
  }
}
