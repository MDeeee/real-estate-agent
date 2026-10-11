import Link from "next/link";
import { Suspense } from "react";
import { buttonClass } from "@/components/ui/button";
import {
  PublicApiError,
  fetchFacets,
  fetchProperties,
} from "@/lib/properties-api";
import type { PropertyPage } from "@/lib/property-schemas";
import {
  parseSearchParams,
  toSearchParams,
  type SearchQuery,
} from "@/lib/property-search";
import { AskAiPanel } from "./_components/ask-ai-panel";
import { FilterPanel } from "./_components/filter-panel";
import { Results } from "./_components/results";
import { SearchSkeleton } from "./_components/search-skeleton";
import { SiteHeader } from "./_components/site-header";

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto grid w-full max-w-7xl flex-1 gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              Find a property in Egypt
            </h1>
            <p className="mt-2 max-w-2xl text-muted">
              Filter published listings by location, type, price and size. Every
              result comes from the same data the AI assistant will use.
            </p>
          </div>
          <Suspense fallback={<SearchSkeleton />}>
            <Search searchParams={searchParams} />
          </Suspense>
        </div>
        <aside className="order-first lg:order-last">
          <AskAiPanel />
        </aside>
      </main>
    </>
  );
}

type ResultsOutcome =
  | { kind: "ok"; data: PropertyPage }
  | { kind: "invalid"; message: string };

async function loadResults(query: SearchQuery): Promise<ResultsOutcome> {
  try {
    return { kind: "ok", data: await fetchProperties(query) };
  } catch (error) {
    if (error instanceof PublicApiError && error.status === 400) {
      return { kind: "invalid", message: error.message };
    }
    throw error;
  }
}

async function Search({
  searchParams,
}: {
  searchParams: PageProps<"/">["searchParams"];
}) {
  const query = parseSearchParams(await searchParams);
  const [facets, outcome] = await Promise.all([
    fetchFacets(),
    loadResults(query),
  ]);

  return (
    <>
      <FilterPanel
        key={toSearchParams(query).toString()}
        query={query}
        facets={facets}
      />
      {outcome.kind === "ok" ? (
        <Results query={query} data={outcome.data} />
      ) : (
        <div
          role="alert"
          className="rounded-xl border border-border bg-danger-soft p-5 text-sm text-danger"
        >
          <p className="font-medium">These filters cannot be combined.</p>
          <p className="mt-1 whitespace-pre-line">{outcome.message}</p>
          <Link href="/" className={`${buttonClass("secondary")} mt-4`}>
            Reset filters
          </Link>
        </div>
      )}
    </>
  );
}
