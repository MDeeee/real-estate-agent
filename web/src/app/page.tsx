import type { ReactNode } from "react";

function Panel({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="flex min-h-96 flex-col rounded-xl border border-border bg-surface p-6"
    >
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      <div className="mt-4 flex-1 text-sm text-muted">{children}</div>
    </section>
  );
}

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">
          Find a property in Egypt
        </h1>
        <p className="mt-2 max-w-2xl text-muted">
          Ask the assistant in Arabic or English, and compare its answers with a
          regular filter search over the same listings.
        </p>
      </header>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel id="chat-heading" title="Ask the AI">
          <p>Chat will appear here.</p>
        </Panel>
        <Panel id="search-heading" title="Filter search">
          <p>Filters and results will appear here.</p>
        </Panel>
      </div>
    </main>
  );
}
