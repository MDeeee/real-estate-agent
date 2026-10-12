import { API_UNREACHABLE_MESSAGE, apiBaseUrl } from "@/lib/api-base";
import { newThreadId, readThreadId, threadCookie } from "@/lib/chat-cookie";
import { BodyTooLargeError, readLimitedBody } from "@/lib/read-limited-body";
import { visitorHeaders } from "@/lib/visitor-headers";

const MAX_BODY_BYTES = 16 * 1024;

function jsonError(message: string, status: number): Response {
  return Response.json({ message }, { status });
}

/**
 * Passes the API's answer through untouched. The body is handed on as a stream
 * (no buffering), and `no-transform` keeps proxies and the Next.js compressor
 * from holding back server-sent events. `Retry-After` of a 429/503 is kept so
 * the page can say how long to wait.
 */
function passThrough(upstream: Response, setCookie?: string): Response {
  const headers = new Headers({
    "content-type":
      upstream.headers.get("content-type") ?? "application/json",
    "cache-control": "no-cache, no-transform",
    "x-accel-buffering": "no",
  });
  const retryAfter = upstream.headers.get("retry-after");
  if (retryAfter) headers.set("retry-after", retryAfter);
  if (setCookie) headers.append("set-cookie", setCookie);
  return new Response(upstream.body, { status: upstream.status, headers });
}

async function callApi(
  path: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetch(`${apiBaseUrl()}${path}`, {
      ...init,
      cache: "no-store",
      headers: { ...init.headers, ...(await visitorHeaders()) },
    });
  } catch {
    // A visitor pressing Stop or closing the tab aborts the upstream request
    // too. Nobody is left to read the response, and it is no server error.
    if (init.signal?.aborted) return new Response(null, { status: 499 });
    return jsonError(API_UNREACHABLE_MESSAGE, 503);
  }
}

/** Nginx's "client closed request": the visitor left, nobody reads the answer. */
const CLIENT_CLOSED = 499;

/**
 * A request the visitor abandoned (Stop, closing the tab, the dev-mode Strict
 * Mode remount that aborts the first history GET) is no server error, however
 * the upstream call ended: it gets an empty 499 and the upstream body is
 * released.
 */
function clientClosed(request: Request, upstream: Response): Response | null {
  if (!request.signal.aborted) return null;
  void upstream.body?.cancel().catch(() => undefined);
  return new Response(null, { status: CLIENT_CLOSED });
}

function isMessageBody(value: unknown): value is { message: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof value.message === "string"
  );
}

/**
 * Sends one chat message. The conversation id is the httpOnly `chat_thread`
 * cookie; a visitor without a valid one gets a fresh id (generated here, so it
 * never exists in page scripts) and the cookie that stores it.
 */
export async function POST(request: Request): Promise<Response> {
  let text: string;
  try {
    text = await readLimitedBody(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return jsonError("The message is too large.", 413);
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return jsonError("That message could not be read.", 400);
  }
  if (!isMessageBody(parsed)) {
    return jsonError("That message could not be read.", 400);
  }

  const existing = readThreadId(request.headers.get("cookie"));
  const threadId = existing ?? newThreadId();
  const upstream = await callApi("/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ threadId, message: parsed.message }),
    signal: request.signal,
  });
  const closed = clientClosed(request, upstream);
  if (closed) return closed;
  return passThrough(
    upstream,
    existing
      ? undefined
      : threadCookie(threadId, process.env.NODE_ENV === "production"),
  );
}

/** The stored conversation of the cookie's thread; empty when there is none yet. */
export async function GET(request: Request): Promise<Response> {
  const threadId = readThreadId(request.headers.get("cookie"));
  if (!threadId) {
    return Response.json(
      { messages: [] },
      { headers: { "cache-control": "no-store" } },
    );
  }
  const upstream = await callApi(`/chat/${threadId}`, {
    signal: request.signal,
  });
  return clientClosed(request, upstream) ?? passThrough(upstream);
}
