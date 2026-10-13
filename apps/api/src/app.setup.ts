import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { bodyParserErrorHandler } from './common/body-parser-error.handler.js';
import type { Env } from './config/env.schema.js';

export const API_PREFIX = 'api';

/**
 * JSON bodies are chat messages (1,000 characters at most): 16 KB is generous.
 * File uploads are multipart and have their own limits.
 */
export const JSON_BODY_LIMIT = '16kb';

/** API answers are per visitor and must never come from a shared or browser cache. */
function noStore(_request: Request, response: Response, next: NextFunction) {
  response.setHeader('Cache-Control', 'no-store');
  next();
}

/**
 * Everything about the HTTP layer that is not a feature. `main.ts` and the
 * integration tests share it, so the tests run the production setup.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const isProduction = config.get('NODE_ENV', { infer: true }) === 'production';

  // Express derives `request.ip` (the rate-limit key) from this. 0 means
  // `X-Forwarded-For` is ignored; N trusts the N proxies in front of us.
  app.set('trust proxy', config.get('TRUSTED_PROXY_HOPS', { infer: true }));

  app.use(
    helmet({
      contentSecurityPolicy: {
        // Plain-HTTP localhost must keep working outside production.
        directives: isProduction ? {} : { upgradeInsecureRequests: null },
      },
    }),
  );
  app.use(cookieParser());
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.useBodyParser('urlencoded', { limit: JSON_BODY_LIMIT, extended: true });
  // Must follow the parsers: Express hands their errors to later handlers only.
  app.use(bodyParserErrorHandler);

  app.setGlobalPrefix(API_PREFIX);
  app.use(`/${API_PREFIX}`, noStore);
  app.enableShutdownHooks();
}
