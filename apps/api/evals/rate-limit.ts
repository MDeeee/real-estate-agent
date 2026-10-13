const RATE_LIMIT_TEXT =
  /\b429\b|rate.?limit|quota|resource_exhausted|too many requests/i;

/** Whether an error (or its cause chain) is a provider rate-limit response. */
export function isRateLimitError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const { status, statusCode, message, cause } = current as {
      status?: unknown;
      statusCode?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (status === 429 || statusCode === 429) return true;
    if (typeof message === 'string' && RATE_LIMIT_TEXT.test(message)) {
      return true;
    }
    current = cause;
  }
  return false;
}

export interface RetryOptions {
  /** Pause before the retry. */
  waitMs: number;
  onRetry?: (error: unknown) => void;
  sleep?: (ms: number) => Promise<void>;
}

/** Runs `run`; when it fails with a rate-limit error, waits and runs it once more. */
export async function retryOnRateLimit<T>(
  run: () => Promise<T>,
  {
    waitMs,
    onRetry,
    sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  }: RetryOptions,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!isRateLimitError(error)) throw error;
    onRetry?.(error);
    await sleep(waitMs);
    return run();
  }
}
