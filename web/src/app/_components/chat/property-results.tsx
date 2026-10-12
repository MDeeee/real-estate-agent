import { cardDomId } from "@/lib/chat-citations";
import type { ChatCard } from "@/lib/chat-schemas";
import { CompactPropertyCard } from "./compact-property-card";

/**
 * The listings an answer cited, prominently and in citation order. The other
 * retrieved candidates stay one click away in a native, collapsed disclosure,
 * so the cards on screen never contradict the text.
 */
export function PropertyResults({
  messageId,
  cited,
  other,
  highlighted,
}: {
  messageId: string;
  cited: readonly ChatCard[];
  other: readonly ChatCard[];
  highlighted: string | null;
}) {
  return (
    <>
      {cited.length > 0 ? (
        <ul className="grid w-full gap-2" aria-label="Listings mentioned in the answer">
          {cited.map((property) => (
            <li key={property.slug}>
              <CompactPropertyCard
                property={property}
                domId={cardDomId(messageId, property.slug)}
                highlighted={highlighted === property.slug}
              />
            </li>
          ))}
        </ul>
      ) : null}
      {other.length > 0 ? (
        <details className="group w-full rounded-lg border border-border bg-background text-sm">
          <summary className="cursor-pointer select-none rounded-lg px-3 py-2 text-xs font-medium text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
            Other matches ({other.length})
          </summary>
          <ul className="grid gap-2 px-3 pb-3" aria-label="Other matches">
            {other.map((property) => (
              <li key={property.slug}>
                <CompactPropertyCard property={property} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}
