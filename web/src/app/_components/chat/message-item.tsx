import { Button } from "@/components/ui/button";
import { BookingCard } from "./booking-card";
import { CompactPropertyCard } from "./compact-property-card";
import { SearchSummary } from "./search-summary";
import type { ChatMessage, ChatStage } from "./use-chat";

const STAGE_LABELS: Record<ChatStage, string> = {
  thinking: "Thinking…",
  searching: "Searching listings…",
  booking: "Preparing your booking…",
};

export function MessageItem({
  message,
  stage,
  canRetry,
  onRetry,
}: {
  message: ChatMessage;
  stage: ChatStage | null;
  canRetry: boolean;
  onRetry: () => void;
}) {
  if (message.role === "user") {
    return (
      <li className="flex justify-end">
        <p
          dir="auto"
          className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-accent px-3.5 py-2 text-sm text-accent-foreground"
        >
          {message.text}
        </p>
      </li>
    );
  }

  const waiting = message.streaming && !message.text && !message.error;
  return (
    <li className="flex flex-col items-start gap-2">
      {message.search ? <SearchSummary summary={message.search} /> : null}
      {message.properties && message.properties.length > 0 ? (
        <ul className="grid w-full gap-2" aria-label="Matching properties">
          {message.properties.map((property) => (
            <li key={property.slug}>
              <CompactPropertyCard property={property} />
            </li>
          ))}
        </ul>
      ) : null}
      {waiting ? (
        <p className="text-sm text-muted">
          {STAGE_LABELS[stage ?? "thinking"]}
        </p>
      ) : null}
      {message.text ? (
        <p
          dir="auto"
          className="max-w-[92%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-sm border border-border bg-background px-3.5 py-2 text-sm leading-relaxed"
        >
          {message.text}
        </p>
      ) : null}
      {message.booking ? <BookingCard booking={message.booking} /> : null}
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
