import type { NextFunction, Request, Response } from 'express';

/** What `body-parser` (through `http-errors`) puts on the errors it raises. */
interface BodyParserError extends Error {
  status: number;
  type: string;
}

/** Messages a visitor or script can act on, by the parser's error `type`. */
const MESSAGES: Record<string, string> = {
  'entity.too.large': 'The request body is too large',
  'entity.parse.failed': 'The request body is not valid JSON',
  'charset.unsupported': 'The request body uses an unsupported charset',
  'encoding.unsupported': 'The request body uses an unsupported encoding',
};

const ERROR_NAMES: Record<number, string> = {
  400: 'Bad Request',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
};

function isBodyParserError(error: unknown): error is BodyParserError {
  if (!(error instanceof Error)) return false;
  const { status, type } = error as Partial<BodyParserError>;
  return (
    typeof type === 'string' &&
    typeof status === 'number' &&
    status >= 400 &&
    status < 500
  );
}

/**
 * Express error middleware for the body parsers. They run before Nest's
 * router, so their errors never reach Nest's exception filters and would
 * otherwise get Express's HTML page and a logged stack trace. This answers
 * with the same JSON shape as the rest of the API; anything that is not a
 * parser error goes on to the next handler.
 */
export function bodyParserErrorHandler(
  error: unknown,
  _request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (!isBodyParserError(error) || response.headersSent) {
    next(error);
    return;
  }
  const { status } = error;
  response.status(status).json({
    statusCode: status,
    error: ERROR_NAMES[status] ?? 'Bad Request',
    message: MESSAGES[error.type] ?? 'The request body could not be read',
  });
}
