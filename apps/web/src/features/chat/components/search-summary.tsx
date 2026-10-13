import { buttonClass } from "@/shared/ui/button";
import {
  filterChips,
  filtersToHref,
  hasActiveFilters,
  unsupportedFilterLabels,
} from "@/features/chat/chat-filters";
import type { SearchSummary as Summary } from "@/features/chat/api/chat-schemas";

export function SearchSummary({
  summary,
  onOpenSearch,
}: {
  summary: Summary;
  /** Shows the regular search with these filters applied (a path such as `/?city=Zamalek`). */
  onOpenSearch: (href: string) => void;
}) {
  const chips = filterChips(summary.filters);
  const skipped = unsupportedFilterLabels(summary.filters);

  return (
    <div className="rounded-lg border border-border bg-background p-3 text-xs">
      <p className="font-medium text-muted">Searched with</p>
      {chips.length > 0 ? (
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <li
              key={chip.key}
              className="rounded-full border border-border bg-surface px-2 py-0.5"
            >
              <span className="text-muted">{chip.label} =</span>{" "}
              <span dir="auto" className="font-medium">
                {chip.value}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1">No filters (all listings)</p>
      )}
      {summary.semanticQuery ? (
        <p dir="auto" className="mt-1.5 text-muted">
          Ranked by meaning: &ldquo;{summary.semanticQuery}&rdquo;
        </p>
      ) : null}
      {hasActiveFilters(summary.filters) ? (
        <button
          type="button"
          className={`${buttonClass("secondary")} mt-2 w-full text-xs`}
          onClick={() => onOpenSearch(filtersToHref(summary.filters))}
        >
          Open these filters in the regular search
        </button>
      ) : null}
      {skipped.length > 0 ? (
        <p className="mt-1.5 text-muted">
          The regular form has no {skipped.join(", ").toLowerCase()} filter, so{" "}
          {skipped.length === 1 ? "it is" : "they are"} not carried over.
        </p>
      ) : null}
    </div>
  );
}
