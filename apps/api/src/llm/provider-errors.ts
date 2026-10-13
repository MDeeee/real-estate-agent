/**
 * The provider could not serve a call in time: it answered 429, 503 or
 * "overloaded", or one call exceeded `LLM_CALL_TIMEOUT_MS`. The chat turn ends
 * at once with a friendly message instead of retrying and waiting.
 */
export class ProviderBusyError extends Error {
  constructor(
    readonly kind: 'busy' | 'timeout',
    cause?: unknown,
  ) {
    super(
      kind === 'timeout'
        ? 'The AI provider did not answer in time.'
        : 'The AI provider is busy or rate limited.',
      { cause },
    );
    this.name = 'ProviderBusyError';
  }
}

/**
 * The provider will not serve calls until someone fixes it: a missing or
 * invalid API key (401/403), or an exhausted quota or billing plan. Unlike a
 * busy provider, waiting a minute does not help, so the visitor is told the
 * assistant is not available rather than to try again.
 */
export class ProviderUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('The AI provider rejected the call: quota, billing or API key.', {
      cause,
    });
    this.name = 'ProviderUnavailableError';
  }
}

/** The model returned nothing that matches the requested structure. */
export class StructuredOutputError extends Error {
  constructor(name: string) {
    super(`The model returned no valid "${name}" output.`);
    this.name = 'StructuredOutputError';
  }
}

/** HTTP statuses that mean "busy, try again later" (529: Anthropic overloaded). */
const BUSY_STATUSES = new Set([429, 503, 529]);

/** HTTP statuses of a rejected key or permission: permanent until fixed. */
const AUTH_STATUSES = new Set([401, 403]);

const BUSY_MESSAGE =
  /overloaded|high demand|resource[_ ]exhausted|rate[ _-]?limit|too many requests|quota exceeded|try again later|service unavailable/i;
/** "capacity" is only a busy signal next to the status that says so. */
const CAPACITY_MESSAGE = /\bcapacity\b/i;
const BUSY_STATUS_IN_MESSAGE = /\b(?:429|503)\b/;
/** A timeout of the HTTP call itself; the word "timeout" elsewhere proves nothing. */
const TIMEOUT_MESSAGE =
  /\b(?:request|connection|socket|gateway|upstream|read) (?:timed? ?out|timeout)\b|\bETIMEDOUT\b|^timed out\b/i;
const TIMEOUT_NAMES = new Set(['APIConnectionTimeoutError']);

/** Permanent failures: exhausted quota or plan, a daily quota, a rejected key. */
const UNAVAILABLE_MESSAGE =
  /insufficient[_ ]quota|exceeded your current quota|check your plan and billing|billing (?:details|account|hard limit)|per ?day|daily (?:quota|limit)|(?:invalid|incorrect|missing|no) api[ _-]?key|api key (?:not valid|is missing|not found|expired)|permission[_ ]denied|unauthenticated|authentication (?:failed|error)/i;

function statusOf(error: object): number | undefined {
  const candidates = [
    (error as { status?: unknown }).status,
    (error as { statusCode?: unknown }).statusCode,
    (error as { response?: { status?: unknown } }).response?.status,
    (error as { error?: { code?: unknown } }).error?.code,
  ];
  return candidates.find((value): value is number => typeof value === 'number');
}

function isAbort(error: object): boolean {
  const name = (error as { name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

function messageOf(error: object): string | undefined {
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' ? message : undefined;
}

function looksUnavailable(error: unknown, depth = 0): boolean {
  if (typeof error !== 'object' || error === null || depth > 3) return false;
  if (isAbort(error)) return false;
  const status = statusOf(error);
  if (status !== undefined && AUTH_STATUSES.has(status)) return true;
  const message = messageOf(error);
  if (message !== undefined && UNAVAILABLE_MESSAGE.test(message)) return true;
  return looksUnavailable((error as { cause?: unknown }).cause, depth + 1);
}

function looksBusy(error: unknown, depth = 0): boolean {
  if (typeof error !== 'object' || error === null || depth > 3) return false;
  // An AbortSignal firing (the turn deadline, the visitor leaving) is not the provider.
  if (isAbort(error)) return false;
  const status = statusOf(error);
  if (status !== undefined && BUSY_STATUSES.has(status)) return true;
  const message = messageOf(error);
  if (message !== undefined) {
    if (BUSY_MESSAGE.test(message) || TIMEOUT_MESSAGE.test(message)) {
      return true;
    }
    if (
      CAPACITY_MESSAGE.test(message) &&
      BUSY_STATUS_IN_MESSAGE.test(message)
    ) {
      return true;
    }
  }
  const name = (error as { name?: unknown }).name;
  if (typeof name === 'string' && TIMEOUT_NAMES.has(name)) return true;
  return looksBusy((error as { cause?: unknown }).cause, depth + 1);
}

/**
 * Whether the adapter classified the failure as "provider busy or too slow"
 * (429, 503, overloaded, a call timeout), directly or as the cause of another error.
 */
export function isProviderBusyError(error: unknown, depth = 0): boolean {
  if (error instanceof ProviderBusyError) return true;
  if (typeof error !== 'object' || error === null || depth > 3) return false;
  return isProviderBusyError((error as { cause?: unknown }).cause, depth + 1);
}

/**
 * Whether the adapter classified the failure as "the provider will not serve
 * calls" (quota or billing exhausted, a rejected key), directly or as a cause.
 */
export function isProviderUnavailableError(error: unknown, depth = 0): boolean {
  if (error instanceof ProviderUnavailableError) return true;
  if (typeof error !== 'object' || error === null || depth > 3) return false;
  return isProviderUnavailableError(
    (error as { cause?: unknown }).cause,
    depth + 1,
  );
}

/**
 * Turns a failed provider call into a `ProviderUnavailableError` (permanent:
 * quota, billing, key) or a `ProviderBusyError` (temporary: 429, 503,
 * overloaded, a timeout) when that is what it was; any other error (and a
 * deliberate abort by the turn deadline or the visitor, `aborted`) is
 * returned unchanged.
 */
export function asProviderError(
  error: unknown,
  { callTimedOut, aborted }: { callTimedOut: boolean; aborted: boolean },
): unknown {
  if (
    error instanceof ProviderBusyError ||
    error instanceof ProviderUnavailableError
  ) {
    return error;
  }
  if (aborted) return error;
  if (callTimedOut) return new ProviderBusyError('timeout', error);
  // Checked first: an exhausted quota also arrives as a 429.
  if (looksUnavailable(error)) return new ProviderUnavailableError(error);
  if (looksBusy(error)) return new ProviderBusyError('busy', error);
  return error;
}
