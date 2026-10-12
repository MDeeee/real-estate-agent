import { segmentCitations } from "@/lib/chat-citations";
import type { ChatCard } from "@/lib/chat-schemas";

const badgeClass =
  "mx-0.5 inline-block max-w-[14rem] truncate rounded-full border border-border bg-surface px-2 py-0.5 align-bottom text-xs font-medium leading-snug";

/**
 * The assistant's text with `[slug]` citations shown as badges carrying the
 * listing's title. A badge scrolls to and highlights that listing's card once
 * the answer is complete; while it streams the cards are not on screen yet, so
 * the badge is a plain label. A citation of a listing this turn does not know
 * is never printed raw.
 */
export function CitationText({
  text,
  properties,
  streaming,
  onSelect,
}: {
  text: string;
  properties: readonly ChatCard[];
  streaming: boolean;
  onSelect: (slug: string) => void;
}) {
  const titles = new Map(properties.map((card) => [card.slug, card.title]));
  const segments = segmentCitations(text, new Set(titles.keys()), { streaming });

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === "text") return segment.text;
        const title = titles.get(segment.slug) ?? segment.slug;
        return streaming ? (
          <span key={index} dir="auto" className={badgeClass} title={title}>
            {title}
          </span>
        ) : (
          <button
            key={index}
            type="button"
            dir="auto"
            title={title}
            aria-label={`Show listing: ${title}`}
            onClick={() => onSelect(segment.slug)}
            className={`${badgeClass} cursor-pointer text-accent hover:bg-border/40 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent`}
          >
            {title}
          </button>
        );
      })}
    </>
  );
}
