import { useEffect, useRef, type ReactNode } from "react";
import { MessageItem } from "./message-item";
import type { ChatMessage, ChatStage } from "../types";

export function MessageList({
  messages,
  stage,
  busy,
  empty,
  onRetry,
  onOpenSearch,
}: {
  messages: ChatMessage[];
  stage: ChatStage | null;
  busy: boolean;
  empty: ReactNode;
  onRetry: () => void;
  onOpenSearch: (href: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const last = messages.at(-1);

  useEffect(() => {
    // Scroll the list itself: scrollIntoView would also move the whole page.
    const list = scrollRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [
    messages.length,
    last?.text,
    last?.properties,
    last?.booking,
    last?.error,
    last?.streaming,
    last?.stopped,
  ]);

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
    >
      {messages.length === 0 ? empty : null}
      {/* Always mounted (empty at first) so screen readers register the live region before messages arrive. */}
      <ol
        aria-live="polite"
        aria-relevant="additions text"
        aria-busy={busy}
        aria-label="Conversation"
        className="flex flex-col gap-4"
      >
        {messages.map((message, index) => (
          <MessageItem
            key={message.id}
            message={message}
            stage={stage}
            canRetry={!busy && index === messages.length - 1}
            onRetry={onRetry}
            onOpenSearch={onOpenSearch}
          />
        ))}
      </ol>
    </div>
  );
}
