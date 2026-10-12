import type { ChatCard } from "@/lib/chat-schemas";
import { formatNumber, formatPrice } from "@/lib/format";

export function CompactPropertyCard({ property }: { property: ChatCard }) {
  const isRent = property.listing === "RENT";
  const location = [property.compound, property.district, property.city]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="rounded-lg border border-border bg-background p-3">
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
