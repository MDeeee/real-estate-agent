import { chatEventSchema, type ChatEvent } from "./chat-schemas";

/**
 * Reads a `text/event-stream` body and calls `onEvent` for each valid event.
 * Comment lines (heartbeats) and malformed events are skipped.
 */
export async function readChatStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ChatEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const flush = (block: string) => {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return;
    try {
      const parsed = chatEventSchema.safeParse(JSON.parse(data));
      if (parsed.success) onEvent(parsed.data);
    } catch {
      // A truncated or non-JSON block is ignored.
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    buffer = buffer.replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      flush(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
    if (done) break;
  }
  if (buffer.trim()) flush(buffer);
}
