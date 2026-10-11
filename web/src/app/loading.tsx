import { AskAiPanel } from "./_components/ask-ai-panel";
import { HOME_GRID_CLASS, ASIDE_CLASS } from "./_components/home-layout";
import { SearchSkeleton } from "./_components/search-skeleton";
import { SiteHeader } from "./_components/site-header";

export default function Loading() {
  return (
    <>
      <SiteHeader />
      <main className={HOME_GRID_CLASS}>
        <div className="h-16 max-w-xl min-w-0 animate-pulse rounded-md bg-border/40" />
        <SearchSkeleton />
        <aside className={ASIDE_CLASS}>
          <AskAiPanel />
        </aside>
      </main>
    </>
  );
}
