import { existsSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { API_PREFIX } from '../app.setup.js';

const logger = new Logger('WebApp');

/** `apps/web/dist` in this repo; the same depth from `src/web` and `dist/web`. */
const DEFAULT_DIST_DIR = resolve(import.meta.dirname, '../../../web/dist');

/** Vite names everything in `assets/` after its content hash: the URL never changes meaning. */
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const REVALIDATE_CACHE_CONTROL = 'no-cache';

const API_PATH = new RegExp(`^/${API_PREFIX}(/|$)`, 'i');

/** Express and Nest route case-insensitively, so `/API/x` is an API path too. */
export function isApiPath(path: string): boolean {
  return API_PATH.test(path);
}

export function resolveWebDistDir(configured: string | undefined): string {
  return configured ? resolve(configured) : DEFAULT_DIST_DIR;
}

/**
 * Serves the built web app from the API's own origin: its files at `/`, and
 * `index.html` for every other GET that is not an API call and not a file
 * request (the client-side router handles `/admin` and the like).
 *
 * Returns false, after a warning, when there is no build; the API itself
 * keeps working.
 */
export function serveWebApp(
  app: NestExpressApplication,
  distDir: string,
): boolean {
  const indexFile = resolve(distDir, 'index.html');
  if (!existsSync(indexFile)) {
    logger.warn(
      `No web build in ${distDir}; serving the API only. Run "pnpm build" (or set WEB_DIST_DIR).`,
    );
    return false;
  }

  const assetsDir = resolve(distDir, 'assets') + sep;
  const serveFile = express.static(distDir, {
    index: false,
    setHeaders: (response, filePath) => {
      response.setHeader(
        'Cache-Control',
        filePath.startsWith(assetsDir)
          ? IMMUTABLE_CACHE_CONTROL
          : REVALIDATE_CACHE_CONTROL,
      );
    },
  });
  // API requests skip the file lookup: none of them is a file of the web app.
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (isApiPath(request.path)) next();
    else serveFile(request, response, next);
  });

  app.use((request: Request, response: Response, next: NextFunction) => {
    const isPageRequest =
      (request.method === 'GET' || request.method === 'HEAD') &&
      !isApiPath(request.path) &&
      // A file that does not exist (`/assets/old-hash.js`) is a 404, not the app.
      extname(request.path) === '';
    if (!isPageRequest) {
      next();
      return;
    }
    response.setHeader('Cache-Control', REVALIDATE_CACHE_CONTROL);
    response.sendFile(indexFile, (error) => {
      if (error) next(error);
    });
  });
  logger.log(`Serving the web app from ${distDir}`);
  return true;
}
