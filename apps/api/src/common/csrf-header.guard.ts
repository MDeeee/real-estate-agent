import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

export const CSRF_HEADER = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'fetch';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Requires `X-Requested-With: fetch` on every state-changing request.
 *
 * Cookies authenticate the chat and the admin area, and a browser attaches
 * them to any request aimed at this origin, including a form posted from
 * another site. A custom header cannot be set by a plain cross-site form or
 * image, and a cross-site `fetch` that sets it needs a CORS preflight, which
 * this server never grants (it has no CORS configuration). Together with
 * `SameSite` cookies this closes cross-site request forgery.
 */
@Injectable()
export class CsrfHeaderGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method)) return true;
    if (request.header(CSRF_HEADER) !== CSRF_HEADER_VALUE) {
      throw new ForbiddenException(
        `Send the "${CSRF_HEADER}: ${CSRF_HEADER_VALUE}" header with state-changing requests.`,
      );
    }
    return true;
  }
}
