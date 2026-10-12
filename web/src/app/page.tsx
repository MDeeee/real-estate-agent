import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { buttonClass } from "@/components/ui/button";
import { describeFilterIssues } from "@/lib/filter-errors";
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
import { ChatPanel } from "./_components/chat-panel";
import { FilterPanel } from "./_components/filter-panel";
import { HomeShell } from "./_components/home-shell";
import { Results } from "./_components/results";
import { SearchSkeleton } from "./_components/search-skeleton";
import { SiteHeader } from "./_components/site-header";

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-tight">
            Find a property in Egypt
          </h1>
          <p className="mt-2 max-w-2xl text-muted">
            Ask the AI assistant in Arabic or English, or filter the listings
            yourself. Both search the same data, so you can compare them.
          </p>
        </div>
        <HomeShell
          chat={<ChatPanel />}
          search={
            <Suspense fallback={<SearchSkeleton />}>
              <Search searchParams={searchParams} />
            </Suspense>
          }
        />
      </main>
    </>
  );
}

type ResultsOutcome =
  | { kind: "ok"; data: PropertyPage }
  | { kind: "invalid"; problems: string[] };

async function loadResults(query: SearchQuery): Promise<ResultsOutcome> {
  try {
    return { kind: "ok", data: await fetchProperties(query) };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof PublicApiError && error.status === 400) {
      return { kind: "invalid", problems: describeFilterIssues(error.issues) };
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
    fetchFacets(query.city),
    loadResults(query),
  ]);

  return (
    <>
      <FilterPanel
        key={toSearchParams(query).toString()}
        query={query}
        facets={facets}
      />
      <div className="min-w-0">
        {outcome.kind === "ok" ? (
          <Results query={query} data={outcome.data} />
        ) : (
          <div
            role="alert"
            className="rounded-xl border border-border bg-danger-soft p-5 text-sm text-danger"
          >
            <p className="font-medium">These filters cannot be combined.</p>
            <ul className="mt-1 space-y-1">
              {outcome.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
            <Link href="/" className={`${buttonClass("secondary")} mt-4`}>
              Reset filters
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
