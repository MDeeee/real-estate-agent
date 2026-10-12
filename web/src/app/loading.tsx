import { ChatPanel } from "./_components/chat-panel";
import { HomeShell } from "./_components/home-shell";
import { SearchSkeleton } from "./_components/search-skeleton";
import { SiteHeader } from "./_components/site-header";

export default function Loading() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
        <div className="h-16 max-w-xl min-w-0 animate-pulse rounded-md bg-border/40" />
        <HomeShell chat={<ChatPanel />} search={<SearchSkeleton />} />
      </main>
    </>
  );
}
