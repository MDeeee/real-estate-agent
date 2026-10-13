import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { ApiError, describeError } from "@/shared/api/http";
import { Button, buttonClass } from "@/shared/ui/button";
import { useFacets, useProperties } from "../api/properties-api";
import { describeFilterIssues } from "../filter-errors";
import { parseSearchParams, toSearchParams } from "../search-params";
import { FilterPanel } from "./filter-panel";
import { Results } from "./results";
import { SearchSkeleton } from "./search-skeleton";

/**
 * The regular filter search. The URL is its state: `?city=...&page=2` is read
 * into a query, the query is fetched, and applying the form navigates to a new URL.
 */
export function SearchPanel() {
  const [searchParams] = useSearchParams();
  const query = useMemo(() => parseSearchParams(searchParams), [searchParams]);
  const properties = useProperties(query);
  const facets = useFacets(query.city);

  // Contradictory filters (400) are not a failure of the page: the form stays
  // so they can be fixed.
  const invalidFilters =
    properties.error instanceof ApiError && properties.error.status === 400
      ? describeFilterIssues(properties.error.issues)
      : null;
  const failure = invalidFilters
    ? facets.error
    : (properties.error ?? facets.error);
  if (failure) {
    return (
      <LoadError
        error={failure}
        onRetry={() => {
          void properties.refetch();
          void facets.refetch();
        }}
      />
    );
  }
  if (properties.isPending || !facets.data) return <SearchSkeleton />;

  return (
    <>
      <FilterPanel
        // A new URL is a new form: the inputs show what the URL says. The key
        // changes again when the facets of a new city arrive.
        key={`${toSearchParams(query).toString()}|${facets.isPlaceholderData}`}
        query={query}
        facets={facets.data}
        pending={properties.isFetching}
      />
      <div
        className="min-w-0"
        aria-busy={properties.isPlaceholderData}
      >
        {invalidFilters ? (
          <div
            role="alert"
            className="rounded-xl border border-border bg-danger-soft p-5 text-sm text-danger"
          >
            <p className="font-medium">These filters cannot be combined.</p>
            <ul className="mt-1 space-y-1">
              {invalidFilters.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
            <Link to="/" className={`${buttonClass("secondary")} mt-4`}>
              Reset filters
            </Link>
          </div>
        ) : properties.data ? (
          <div
            className={
              properties.isPlaceholderData
                ? "opacity-60 transition-opacity"
                : "transition-opacity"
            }
          >
            <Results query={query} data={properties.data} />
          </div>
        ) : null}
      </div>
    </>
  );
}

function LoadError({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-border bg-surface p-6"
    >
      <h2 className="text-lg font-semibold">Could not load properties</h2>
      <p className="mt-2 text-sm text-muted">
        {describeError(error, "An unexpected error occurred.")}
      </p>
      <Button className="mt-4" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
