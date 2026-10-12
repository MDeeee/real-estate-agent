/**
 * The chat thread id lives in an httpOnly cookie managed by the Next route
 * handlers, never in JavaScript: the id is a bearer token for the conversation
 * (it unlocks the stored history), so page scripts must not be able to read it.
 */
export const CHAT_COOKIE = "chat_thread";
/** Only the chat routes receive the cookie. */
export const CHAT_COOKIE_PATH = "/api/chat";
export const CHAT_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isThreadId(value: string | undefined): value is string {
  return value !== undefined && UUID.test(value);
}

/** The thread id in a `Cookie` header, or `undefined` when missing or not a UUID. */
export function readThreadId(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== CHAT_COOKIE) continue;
    const value = part.slice(separator + 1).trim();
    return isThreadId(value) ? value : undefined;
  }
  return undefined;
}

/** A fresh thread id; server-side only, so it also works over plain HTTP. */
export function newThreadId(): string {
  return crypto.randomUUID();
}

/** The `Set-Cookie` value that stores `threadId`. */
export function threadCookie(threadId: string, secure: boolean): string {
  return [
    `${CHAT_COOKIE}=${threadId}`,
    `Path=${CHAT_COOKIE_PATH}`,
    `Max-Age=${CHAT_COOKIE_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}
