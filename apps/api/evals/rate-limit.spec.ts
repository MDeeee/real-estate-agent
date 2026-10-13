import { describe, expect, it } from 'vitest';
import { isRateLimitError, retryOnRateLimit } from './rate-limit.js';

describe('isRateLimitError', () => {
  it('recognises a 429 status in the usual places', () => {
    expect(
      isRateLimitError(Object.assign(new Error('x'), { status: 429 })),
    ).toBe(true);
    expect(
      isRateLimitError(Object.assign(new Error('x'), { statusCode: 429 })),
    ).toBe(true);
  });

  it('recognises provider wording and wrapped causes', () => {
    expect(isRateLimitError(new Error('429 Too Many Requests'))).toBe(true);
    expect(isRateLimitError(new Error('RESOURCE_EXHAUSTED: quota'))).toBe(true);
    expect(
      isRateLimitError(
        new Error('The model returned no valid output', {
          cause: new Error('Rate limit reached for requests'),
        }),
      ),
    ).toBe(true);
  });

  it('ignores other errors and survives cause cycles', () => {
    expect(isRateLimitError(new Error('connection refused'))).toBe(false);
    expect(
      isRateLimitError(Object.assign(new Error('x'), { status: 500 })),
    ).toBe(false);
    expect(isRateLimitError(undefined)).toBe(false);
    const loop = new Error('loop');
    (loop as { cause?: unknown }).cause = loop;
    expect(isRateLimitError(loop)).toBe(false);
  });
});

describe('retryOnRateLimit', () => {
  const noSleep = () => Promise.resolve();

  it('returns the first result without waiting', async () => {
    const sleeps: number[] = [];
    const value = await retryOnRateLimit(() => Promise.resolve('ok'), {
      waitMs: 50,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });
    expect(value).toBe('ok');
    expect(sleeps).toEqual([]);
  });

  it('retries exactly once after a rate-limit error', async () => {
    let calls = 0;
    const waits: number[] = [];
    const value = await retryOnRateLimit(
      () => {
        calls += 1;
        return calls === 1
          ? Promise.reject(
              Object.assign(new Error('slow down'), { status: 429 }),
            )
          : Promise.resolve('second');
      },
      {
        waitMs: 50,
        sleep: (ms) => {
          waits.push(ms);
          return Promise.resolve();
        },
      },
    );
    expect(value).toBe('second');
    expect(calls).toBe(2);
    expect(waits).toEqual([50]);
  });

  it('gives up after one retry and does not retry other errors', async () => {
    let calls = 0;
    await expect(
      retryOnRateLimit(
        () => {
          calls += 1;
          return Promise.reject(new Error('429 again'));
        },
        { waitMs: 0, sleep: noSleep },
      ),
    ).rejects.toThrow('429 again');
    expect(calls).toBe(2);

    calls = 0;
    await expect(
      retryOnRateLimit(
        () => {
          calls += 1;
          return Promise.reject(new Error('boom'));
        },
        { waitMs: 0, sleep: noSleep },
      ),
    ).rejects.toThrow('boom');
    expect(calls).toBe(1);
  });
});
