import { useNavigate } from "react-router";
import { ChatPanel } from "@/features/chat/components/chat-panel";
import { SearchPanel } from "@/features/search/components/search-panel";
import { HomeShell } from "./layouts/home-shell";

/** The landing page: the AI chat next to the regular filter search, over the same listings. */
export function HomePage() {
  const navigate = useNavigate();

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <title>Real-estate AI agent</title>
      <div className="min-w-0">
        <h1 className="text-3xl font-semibold tracking-tight">
          Find a property in Egypt
        </h1>
        <p className="mt-2 text-muted">
          Ask the AI assistant in Arabic or English, or filter the listings
          yourself. Both search the same data, so you can compare them.
        </p>
      </div>
      <HomeShell
        chat={({ showSearch }) => (
          <ChatPanel
            onOpenSearch={(href) => {
              void navigate(href);
              showSearch();
            }}
          />
        )}
        search={<SearchPanel />}
      />
    </main>
  );
}
