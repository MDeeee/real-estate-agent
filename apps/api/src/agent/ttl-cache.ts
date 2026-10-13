/**
 * Memoises an async loader for `ttlMs`. Concurrent callers share one load and a
 * failed load is not cached. Process-local, so each API instance has its own.
 */
export function ttlCached<T>(
  ttlMs: number,
  load: () => Promise<T>,
  now: () => number = Date.now,
): () => Promise<T> {
  let cached: { value: T; expiresAt: number } | undefined;
  let inflight: Promise<T> | undefined;

  return async () => {
    if (cached && now() < cached.expiresAt) return cached.value;
    inflight ??= load()
      .then((value) => {
        cached = { value, expiresAt: now() + ttlMs };
        return value;
      })
      .finally(() => {
        inflight = undefined;
      });
    return inflight;
  };
}
