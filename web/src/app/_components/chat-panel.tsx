"use client";

import { Button } from "@/components/ui/button";
import { Composer } from "./chat/composer";
import { MessageList } from "./chat/message-list";
import { Suggestions } from "./chat/suggestions";
import { useChat } from "./chat/use-chat";

export function ChatPanel() {
  const {
    messages,
    stage,
    busy,
    restoring,
    resetting,
    notice,
    send,
    stop,
    retry,
    newChat,
  } = useChat();

  return (
    <section
      aria-labelledby="ask-ai-heading"
      className="flex h-[min(42rem,calc(100dvh-10rem))] flex-col overflow-hidden rounded-xl border border-border bg-surface lg:sticky lg:top-6 lg:h-[calc(100dvh-3rem)]"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 id="ask-ai-heading" className="text-lg font-semibold">
          Ask the AI
        </h2>
        <Button
          variant="ghost"
          onClick={() => void newChat()}
          disabled={(messages.length === 0 && !busy) || resetting}
        >
          New chat
        </Button>
      </div>
      <MessageList
        messages={messages}
        stage={stage}
        busy={busy}
        onRetry={retry}
        empty={
          restoring ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : (
            <Suggestions onPick={(text) => void send(text)} disabled={busy} />
          )
        }
      />
      {notice ? (
        <p
          role="alert"
          className="border-t border-border px-4 py-2 text-sm text-red-700 dark:text-red-400"
        >
          {notice}
        </p>
      ) : null}
      <Composer
        busy={busy}
        disabled={restoring}
        onSend={(text) => void send(text)}
        onStop={stop}
      />
    </section>
  );
}
