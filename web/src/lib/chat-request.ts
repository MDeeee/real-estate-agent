/**
 * After Stop, the API may still be rolling the abandoned turn back and holds
 * its per-conversation lock until it is done, answering 409. The next send
 * waits and retries instead of showing an error.
 */
export const CONFLICT_BACKOFF_MS = [400, 800, 1600] as const;

export interface PostChatOptions {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * POSTs a chat message. A 409 is retried up to three times with 400/800/1600 ms
 * backoff; the last response (409 included) is returned when it never clears.
 * The conversation id is not sent: the server keeps it in an httpOnly cookie.
 */
export async function postChat(
  message: string,
  signal: AbortSignal,
  { fetchImpl = fetch, sleep = abortableSleep }: PostChatOptions = {},
): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetchImpl("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
      signal,
    });
    const delay = CONFLICT_BACKOFF_MS[attempt];
    if (response.status !== 409 || delay === undefined) return response;
    await response.body?.cancel().catch(() => undefined);
    await sleep(delay, signal);
  }
}
