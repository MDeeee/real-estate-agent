import { useEffect, useRef, useState } from "react";
import { Button } from "@/shared/ui/button";
import { cardDomId, citedSlugsIn, splitCards } from "@/features/chat/chat-citations";
import { pluralize } from "@/shared/lib/format";
import { BookingCard } from "./booking-card";
import { CitationText } from "./citation-text";
import { PropertyResults } from "./property-results";
import { SearchSummary } from "./search-summary";
import type { ChatMessage, ChatStage } from "../types";

const STAGE_LABELS: Record<ChatStage, string> = {
  thinking: "Thinking…",
  searching: "Searching listings…",
  booking: "Preparing your booking…",
};

/** How long a card stays highlighted after its citation was clicked. */
const HIGHLIGHT_MS = 2000;

export function MessageItem({
  message,
  stage,
  canRetry,
  onRetry,
  onOpenSearch,
}: {
  message: ChatMessage;
  stage: ChatStage | null;
  canRetry: boolean;
  onRetry: () => void;
  onOpenSearch: (href: string) => void;
}) {
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  if (message.role === "user") {
    return (
      <li className="flex flex-col items-end gap-1">
        <p
          dir="auto"
          className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-accent px-3.5 py-2 text-sm text-accent-foreground"
        >
          {message.text}
        </p>
        {message.stopped ? (
          <p className="text-xs italic text-muted">Stopped</p>
        ) : null}
      </li>
    );
  }

  const properties = message.properties ?? [];
  const waiting = message.streaming && !message.text && !message.error;
  const showSearching =
    message.streaming && properties.length > 0 && !message.error;
  // Cards are shown once the answer is complete (or stopped, or failed); until
  // then only a one-line progress note, so they cannot contradict the text.
  const { cited, other } = message.streaming
    ? { cited: [], other: [] }
    : splitCards(
        properties,
        message.citedSlugs ?? citedSlugsIn(message.text),
      );

  const showCard = (slug: string) => {
    const card = document.getElementById(cardDomId(message.id, slug));
    if (!card) return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    card.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "nearest",
    });
    card.focus({ preventScroll: true });
    setHighlighted(slug);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setHighlighted(null), HIGHLIGHT_MS);
  };

  return (
    <li className="flex flex-col items-start gap-2">
      {message.search ? (
        <SearchSummary summary={message.search} onOpenSearch={onOpenSearch} />
      ) : null}
      {waiting ? (
        <p className="text-sm text-muted">
          {STAGE_LABELS[stage ?? "thinking"]}
        </p>
      ) : null}
      {showSearching ? (
        <p className="text-xs text-muted">
          {pluralize(properties.length, "match", "matches")} found
        </p>
      ) : null}
      {message.text ? (
        <p
          dir="auto"
          className="max-w-[92%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-sm border border-border bg-background px-3.5 py-2 text-sm leading-relaxed"
        >
          <CitationText
            text={message.text}
            properties={properties}
            streaming={message.streaming === true}
            onSelect={showCard}
          />
        </p>
      ) : null}
      <PropertyResults
        messageId={message.id}
        cited={cited}
        other={other}
        highlighted={highlighted}
      />
      {message.booking ? <BookingCard booking={message.booking} /> : null}
      {message.stopped ? (
        <p className="text-xs italic text-muted">Stopped</p>
      ) : null}
      {message.error ? (
        <div
          role="alert"
          className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          <span>{message.error}</span>
          {canRetry ? (
            <Button variant="secondary" onClick={onRetry} className="text-xs">
              Try again
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
