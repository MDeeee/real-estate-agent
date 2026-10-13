import type { ChatCard } from "@/features/chat/api/chat-schemas";
import { formatNumber, formatPrice } from "@/shared/lib/format";
import {
  formatDelivery,
  formatFinishing,
  formatPaymentPlan,
} from "@/shared/lib/property-facts";

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
  const facts = [
    formatDelivery(property.deliveryDate),
    formatFinishing(property.finishing),
  ].filter((fact): fact is string => fact !== null);
  const paymentPlan = formatPaymentPlan(property.paymentPlan);

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
      {facts.length > 0 ? (
        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
          {facts.map((fact) => (
            <li key={fact} dir="auto" className="min-w-0 break-words">
              {fact}
            </li>
          ))}
        </ul>
      ) : null}
      {paymentPlan ? (
        <p
          dir="auto"
          title={property.paymentPlan ?? undefined}
          className="mt-1 line-clamp-2 break-words text-xs text-muted"
        >
          {paymentPlan}
        </p>
      ) : null}
    </article>
  );
}
