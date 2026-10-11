import { AskAiPanel } from "./_components/ask-ai-panel";
import { SearchSkeleton } from "./_components/search-skeleton";
import { SiteHeader } from "./_components/site-header";

export default function Loading() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto grid w-full max-w-7xl flex-1 gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <div className="h-16 max-w-xl animate-pulse rounded-md bg-border/40" />
          <SearchSkeleton />
        </div>
        <aside className="order-first lg:order-last">
          <AskAiPanel />
        </aside>
      </main>
    </>
  );
}
