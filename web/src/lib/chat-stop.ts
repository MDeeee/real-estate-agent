import type { ChatMessage } from "@/app/_components/chat/use-chat";

/**
 * What a Stop leaves of the reply that was streaming:
 * - a booking was made (the server keeps that turn): shown normally, never
 *   labelled "Stopped";
 * - anything else received (text, a search summary, listings): kept and
 *   labelled "Stopped" (the server does not store it);
 * - nothing at all: the empty reply is removed and the visitor's message gets
 *   a "Stopped" marker so it does not look unanswered.
 */
export function settleStopped(messages: ChatMessage[]): ChatMessage[] {
  const last = messages.at(-1);
  if (last?.role !== "assistant" || !last.streaming) return messages;
  const head = messages.slice(0, -1);
  if (last.booking) return [...head, { ...last, streaming: false }];
  if (last.text || last.search || last.properties?.length) {
    return [...head, { ...last, streaming: false, stopped: true }];
  }
  const question = head.at(-1);
  return question?.role === "user"
    ? [...head.slice(0, -1), { ...question, stopped: true }]
    : head;
}
