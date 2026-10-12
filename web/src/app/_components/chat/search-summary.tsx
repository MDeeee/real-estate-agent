"use client";

import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui/button";
import {
  filterChips,
  filtersToHref,
  unsupportedFilterLabels,
} from "@/lib/chat-filters";
import type { SearchSummary as Summary } from "@/lib/chat-schemas";
import { useHomeTabs } from "../home-shell";

export function SearchSummary({ summary }: { summary: Summary }) {
  const router = useRouter();
  const { showSearch } = useHomeTabs();
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
      <button
        type="button"
        className={`${buttonClass("secondary")} mt-2 w-full text-xs`}
        onClick={() => {
          router.push(filtersToHref(summary.filters));
          showSearch();
        }}
      >
        Open these filters in the regular search
      </button>
      {skipped.length > 0 ? (
        <p className="mt-1.5 text-muted">
          The regular form has no {skipped.join(", ").toLowerCase()} filter, so{" "}
          {skipped.length === 1 ? "it is" : "they are"} not carried over.
        </p>
      ) : null}
    </div>
  );
}
