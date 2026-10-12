import { newThreadId, threadCookie } from "@/lib/chat-cookie";

/**
 * "New chat": rotates the `chat_thread` cookie to a fresh conversation id. The
 * previous conversation is left behind untouched; nobody can reach it without
 * its id.
 */
export async function POST(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      "cache-control": "no-store",
      "set-cookie": threadCookie(
        newThreadId(),
        process.env.NODE_ENV === "production",
      ),
    },
  });
}
