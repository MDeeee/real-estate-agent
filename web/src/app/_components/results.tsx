import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonClass } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { lastPageIfBeyond, pageCount } from "@/lib/pagination";
import type { PropertyPage } from "@/lib/property-schemas";
import { hasActiveFilters, hrefFor, type SearchQuery } from "@/lib/property-search";
import { PropertyCard } from "./property-card";

export function Results({
  query,
  data,
}: {
  query: SearchQuery;
  data: PropertyPage;
}) {
  if (data.total === 0) {
    return (
      <section
        aria-labelledby="results-heading"
        className="rounded-xl border border-dashed border-border bg-surface px-6 py-14 text-center"
      >
        <h2 id="results-heading" className="text-lg font-semibold">
          No properties match
        </h2>
        <p className="mt-2 text-sm text-muted">
          {hasActiveFilters(query)
            ? "Try widening the price range or removing a filter."
            : "No listings are published yet."}
        </p>
        {hasActiveFilters(query) ? (
          <Link href="/" className={`${buttonClass("secondary")} mt-5`}>
            Reset filters
          </Link>
        ) : null}
      </section>
    );
  }

  // A bookmarked or hand-edited page past the end would otherwise show an
  // empty list and an inverted "showing 25–24".
  const last = lastPageIfBeyond(data);
  if (last !== null) redirect(hrefFor(query, { page: last }));

  const pages = pageCount(data.total, data.pageSize);
  const from = (data.page - 1) * data.pageSize + 1;
  const to = Math.min(data.total, from + data.items.length - 1);

  return (
    <section aria-labelledby="results-heading">
      <h2 id="results-heading" className="text-sm text-muted" aria-live="polite">
        <span className="font-semibold text-foreground">
          {formatNumber(data.total)}
        </span>{" "}
        {data.total === 1 ? "property" : "properties"}
        {data.total > data.items.length
          ? ` · showing ${from}–${to}`
          : ""}
      </h2>

      <ul className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {data.items.map((property) => (
          <li key={property.id}>
            <PropertyCard property={property} />
          </li>
        ))}
      </ul>

      {pages > 1 ? (
        <nav
          aria-label="Pagination"
          className="mt-6 flex items-center justify-between gap-4 text-sm text-muted"
        >
          <p>
            Page {data.page} of {pages}
          </p>
          <div className="flex gap-2">
            {data.page > 1 ? (
              <Link
                href={hrefFor(query, { page: data.page - 1 })}
                rel="prev"
                className={buttonClass("secondary")}
              >
                Previous
              </Link>
            ) : null}
            {data.page < pages ? (
              <Link
                href={hrefFor(query, { page: data.page + 1 })}
                rel="next"
                className={buttonClass("secondary")}
              >
                Next
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </section>
  );
}
