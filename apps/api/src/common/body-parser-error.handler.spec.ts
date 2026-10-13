import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { bodyParserErrorHandler } from './body-parser-error.handler.js';

function parserError(status: number, type: string): Error {
  return Object.assign(new Error('raw parser message'), { status, type });
}

function run(error: unknown, headersSent = false) {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const next = vi.fn();
  bodyParserErrorHandler(
    error,
    {} as Request,
    { headersSent, status } as unknown as Response,
    next as NextFunction,
  );
  return { json, status, next };
}

describe('bodyParserErrorHandler', () => {
  it('answers an oversized body with a JSON 413', () => {
    const { json, status, next } = run(parserError(413, 'entity.too.large'));
    expect(status).toHaveBeenCalledWith(413);
    expect(json).toHaveBeenCalledWith({
      statusCode: 413,
      error: 'Payload Too Large',
      message: 'The request body is too large',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('answers malformed JSON with a JSON 400 that hides the parser text', () => {
    const { json, status } = run(parserError(400, 'entity.parse.failed'));
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      statusCode: 400,
      error: 'Bad Request',
      message: 'The request body is not valid JSON',
    });
  });

  it('passes other errors on untouched', () => {
    const other = new Error('boom');
    const { status, next } = run(other);
    expect(status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(other);
  });

  it('passes a server-side error that merely has a status on', () => {
    const serverError = parserError(500, 'whatever');
    const { status, next } = run(serverError);
    expect(status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(serverError);
  });

  it('does not answer twice once the response has started', () => {
    const tooLarge = parserError(413, 'entity.too.large');
    const { status, next } = run(tooLarge, true);
    expect(status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(tooLarge);
  });
});
