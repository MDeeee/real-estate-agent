import type { ChatCard } from "@/features/chat/api/chat-schemas";
import { formatNumber, formatPrice } from "@/shared/lib/format";

export function CompactPropertyCard({
  property,
  domId,
  highlighted = false,
}: {
  property: ChatCard;
  /** Lets a citation badge in the answer scroll to this card. */
  domId?: string;
  highlighted?: boolean;
}) {
  const isRent = property.listing === "RENT";
  const location = [property.compound, property.district, property.city]
    .filter(Boolean)
    .join(" · ");

  return (
    <article
      id={domId}
      // Focusable by script only: a citation badge moves focus here. The
      // focus outline stays for as long as the card has focus; the highlight
      // ring below is a separate, fading cue.
      tabIndex={domId ? -1 : undefined}
      className={`rounded-lg border bg-background p-3 transition-shadow duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        highlighted
          ? "border-accent ring-2 ring-accent"
          : "border-border"
      }`}
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <span
          className={`rounded-full px-2 py-0.5 font-medium ${
            isRent ? "bg-border/60 text-foreground" : "bg-accent/15 text-accent"
          }`}
        >
          {isRent ? "For rent" : "For sale"}
        </span>
        <span className="capitalize text-muted">{property.type}</span>
      </div>
      <h4 dir="auto" className="mt-2 text-sm font-semibold leading-snug">
        {property.title}
      </h4>
      <p dir="auto" className="mt-0.5 text-xs text-muted">
        {location}
      </p>
      <p className="mt-2 text-sm font-semibold tabular-nums">
        {formatPrice(property.price, property.currency)}
        {isRent ? (
          <span className="text-xs font-normal text-muted"> /month</span>
        ) : null}
      </p>
      <p className="mt-1 text-xs text-muted">
        {property.bedrooms} bed · {property.bathrooms} bath ·{" "}
        {formatNumber(property.areaM2)} m&sup2;
      </p>
    </article>
  );
}
