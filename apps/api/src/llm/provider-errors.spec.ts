import { describe, expect, it } from 'vitest';
import {
  ProviderBusyError,
  ProviderUnavailableError,
  asProviderError,
  isProviderBusyError,
  isProviderUnavailableError,
} from './provider-errors.js';

const notAborted = { callTimedOut: false, aborted: false };

function httpError(status: number, message = 'failed') {
  return Object.assign(new Error(message), { status });
}

describe('asProviderError', () => {
  it.each([429, 503, 529])('maps HTTP %i to a busy provider', (status) => {
    const result = asProviderError(httpError(status), notAborted);
    expect(result).toBeInstanceOf(ProviderBusyError);
    expect((result as ProviderBusyError).kind).toBe('busy');
  });

  it.each([
    'This model is currently experiencing high demand. Please try again later.',
    'The model is overloaded',
    'Rate limit reached for model',
    'RESOURCE_EXHAUSTED: quota exceeded',
    'Request timed out.',
  ])('maps the message "%s" to a busy provider', (message) => {
    expect(asProviderError(new Error(message), notAborted)).toBeInstanceOf(
      ProviderBusyError,
    );
  });

  it('reads the status of a nested response and of a cause', () => {
    const nested = Object.assign(new Error('x'), { response: { status: 503 } });
    expect(asProviderError(nested, notAborted)).toBeInstanceOf(
      ProviderBusyError,
    );
    const wrapped = new Error('wrapped', { cause: httpError(429) });
    expect(asProviderError(wrapped, notAborted)).toBeInstanceOf(
      ProviderBusyError,
    );
  });

  it('maps a call that hit its own timeout to a timeout', () => {
    const result = asProviderError(new Error('aborted'), {
      callTimedOut: true,
      aborted: false,
    });
    expect(result).toBeInstanceOf(ProviderBusyError);
    expect((result as ProviderBusyError).kind).toBe('timeout');
  });

  it('leaves other errors alone, such as a bug', () => {
    const bug = new TypeError('x is not a function');
    expect(asProviderError(bug, notAborted)).toBe(bug);
  });

  describe('a permanent quota, billing or key failure is not "busy"', () => {
    it.each([
      [
        429,
        'You exceeded your current quota, please check your plan and billing details.',
      ],
      [429, 'insufficient_quota'],
      [
        429,
        'Quota exceeded for metric GenerateRequestsPerDayPerProjectPerModel-FreeTier',
      ],
      [429, 'RESOURCE_EXHAUSTED: daily quota reached'],
      [429, 'Quota exceeded: requests per day limit'],
      [401, 'Incorrect API key provided'],
      [403, 'Forbidden'],
      [400, 'API key not valid. Please pass a valid API key.'],
      [500, 'Missing API key'],
    ])('maps %i "%s" to an unavailable provider', (status, message) => {
      const result = asProviderError(httpError(status, message), notAborted);
      expect(result).toBeInstanceOf(ProviderUnavailableError);
      expect(result).not.toBeInstanceOf(ProviderBusyError);
    });

    it('finds it in the cause chain', () => {
      const wrapped = new Error('wrapped', {
        cause: httpError(429, 'insufficient_quota'),
      });
      expect(asProviderError(wrapped, notAborted)).toBeInstanceOf(
        ProviderUnavailableError,
      );
    });

    it('is recognised directly or as a cause, and is not "busy"', () => {
      const unavailable = new ProviderUnavailableError();
      expect(isProviderUnavailableError(unavailable)).toBe(true);
      expect(
        isProviderUnavailableError(new Error('x', { cause: unavailable })),
      ).toBe(true);
      expect(isProviderBusyError(unavailable)).toBe(false);
      expect(isProviderUnavailableError(new ProviderBusyError('busy'))).toBe(
        false,
      );
    });
  });

  describe('words that do not prove the provider is busy', () => {
    it.each([
      'The listing has a timeout field',
      'No capacity to store the file',
      'Please set a quota for your team',
      'Validation timeout must be positive',
    ])('leaves "%s" alone', (message) => {
      const error = new Error(message);
      expect(asProviderError(error, notAborted)).toBe(error);
    });

    it('still reads capacity next to a 429 or 503 as busy', () => {
      expect(
        asProviderError(new Error('503: the model is at capacity'), notAborted),
      ).toBeInstanceOf(ProviderBusyError);
      expect(
        asProviderError(
          new Error('The server had an error: 429 capacity'),
          notAborted,
        ),
      ).toBeInstanceOf(ProviderBusyError);
    });

    it('still reads a timeout of the HTTP call as busy', () => {
      for (const message of [
        'Request timed out.',
        'connect ETIMEDOUT 1.2.3.4:443',
        'Gateway timeout',
      ]) {
        expect(asProviderError(new Error(message), notAborted)).toBeInstanceOf(
          ProviderBusyError,
        );
      }
    });
  });

  it('never blames the provider for the turn deadline or a visitor who left', () => {
    const abort = new DOMException(
      'The operation was aborted due to timeout',
      'TimeoutError',
    );
    expect(asProviderError(abort, notAborted)).toBe(abort);
    const error = httpError(503);
    expect(asProviderError(error, { callTimedOut: true, aborted: true })).toBe(
      error,
    );
  });
});

describe('isProviderBusyError', () => {
  it('recognises the adapter verdict, directly or as a cause', () => {
    const busy = new ProviderBusyError('busy');
    expect(isProviderBusyError(busy)).toBe(true);
    expect(isProviderBusyError(new Error('outer', { cause: busy }))).toBe(true);
  });

  it('does not guess from the message of an arbitrary error', () => {
    expect(isProviderBusyError(new Error('connection timed out'))).toBe(false);
    expect(isProviderBusyError(httpError(429))).toBe(false);
    expect(isProviderBusyError(undefined)).toBe(false);
  });
});
