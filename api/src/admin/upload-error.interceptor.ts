import {
  BadRequestException,
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Observable } from 'rxjs';
import {
  MAX_FILE_BYTES,
  MAX_FILES_PER_REQUEST,
} from '../ingestion/ingestion.types.js';

/** Multer's own hard ceiling per file; the real rule (200 KB) is enforced per file in the service. */
export const HARD_FILE_LIMIT_BYTES = 1024 * 1024;

export const UPLOAD_FIELD = 'files';

// Multer error messages (Nest turns the multer error codes into these).
const TOO_MANY_FILES = 'Too many files';
const UNEXPECTED_FILE = 'Unexpected file field';

/**
 * Turns the terse multer failures into messages an admin can act on. Multer
 * aborts the whole request on these, so the web app never sends such files;
 * this is the backstop for other clients.
 */
export function describeUploadError(error: unknown): unknown {
  if (error instanceof PayloadTooLargeException) {
    return new PayloadTooLargeException(
      `A file is larger than the ${HARD_FILE_LIMIT_BYTES / 1024} KB upload limit, so nothing was uploaded. Listing files must be at most ${MAX_FILE_BYTES / 1024} KB; remove the oversized file and try again.`,
    );
  }
  if (error instanceof BadRequestException) {
    const message = error.message;
    if (message.startsWith(TOO_MANY_FILES)) {
      return new BadRequestException(
        `Too many files: send at most ${MAX_FILES_PER_REQUEST} files per request.`,
      );
    }
    if (message.startsWith(UNEXPECTED_FILE)) {
      return new BadRequestException(
        `Unexpected upload: attach up to ${MAX_FILES_PER_REQUEST} files in the "${UPLOAD_FIELD}" field, and nothing else.`,
      );
    }
  }
  return error;
}

const MulterFilesInterceptor = FilesInterceptor(
  UPLOAD_FIELD,
  MAX_FILES_PER_REQUEST,
  {
    defParamCharset: 'utf8',
    limits: {
      files: MAX_FILES_PER_REQUEST,
      fileSize: HARD_FILE_LIMIT_BYTES,
    },
  },
);

@Injectable()
export class UploadFilesInterceptor extends MulterFilesInterceptor {
  override async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    try {
      return await super.intercept(context, next);
    } catch (error) {
      throw error instanceof HttpException ? describeUploadError(error) : error;
    }
  }
}
