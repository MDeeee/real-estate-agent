import { formatNumber, formatPrice } from "@/shared/lib/format";
import type { PropertyCard as Property } from "@/shared/domain/property";

export function PropertyCard({ property }: { property: Property }) {
  const location = [property.compound, property.district, property.city]
    .filter(Boolean)
    .join(" · ");
  const isRent = property.listing === "RENT";

  return (
    <article className="flex h-full flex-col rounded-xl border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
            isRent ? "bg-border/60 text-foreground" : "bg-accent/15 text-accent"
          }`}
        >
          {isRent ? "For rent" : "For sale"}
        </span>
        <span className="text-xs capitalize text-muted">{property.type}</span>
      </div>

      <h3 dir="auto" className="mt-3 text-base font-semibold leading-snug">
        {property.title}
      </h3>
      <p dir="auto" className="mt-1 text-sm text-muted">
        {location}
      </p>

      <p className="mt-3 text-lg font-semibold tabular-nums">
        {formatPrice(property.price, property.currency)}
        {isRent ? (
          <span className="text-sm font-normal text-muted"> /month</span>
        ) : null}
      </p>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        <li>{property.bedrooms} bed</li>
        <li>{property.bathrooms} bath</li>
        <li>{formatNumber(property.areaM2)} m&sup2;</li>
      </ul>

      {property.excerpt ? (
        <p dir="auto" className="mt-3 text-sm leading-relaxed text-muted">
          {property.excerpt}
        </p>
      ) : null}
    </article>
  );
}
