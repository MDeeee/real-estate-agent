import type { ReactNode } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { z } from "zod";
import { describeError } from "@/shared/api/http";
import type { Page } from "@/shared/api/page";
import { lastPageIfBeyond } from "@/shared/lib/pagination";
import { Button } from "@/shared/ui/button";
import { useBookings } from "./bookings/bookings-api";
import { BookingsTable } from "./bookings/bookings-table";
import { useDocuments } from "./documents/documents-api";
import { DocumentsTable } from "./documents/documents-table";
import { UploadCard } from "./documents/upload-card";

const querySchema = z.object({
  tab: z.enum(["documents", "bookings"]).catch("documents"),
  page: z.coerce.number().int().min(1).catch(1),
});

const tabs = [
  { id: "documents", label: "Documents" },
  { id: "bookings", label: "Bookings" },
] as const;

export function AdminPage() {
  const [searchParams] = useSearchParams();
  const { tab, page } = querySchema.parse({
    tab: searchParams.get("tab") ?? undefined,
    page: searchParams.get("page") ?? undefined,
  });

  return (
    <div className="space-y-8">
      <title>Admin | Real-estate AI agent</title>
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Admin</h1>
        <p className="mt-2 text-muted">
          Upload property listings, check their indexing status and review
          viewing bookings.
        </p>
      </div>
      <UploadCard />
      <section
        aria-labelledby="records-heading"
        className="overflow-hidden rounded-xl border border-border bg-surface"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 pt-4">
          <h2 id="records-heading" className="pb-3 text-lg font-semibold">
            Records
          </h2>
          <nav aria-label="Admin sections" className="-mb-px flex gap-1">
            {tabs.map(({ id, label }) => (
              <Link
                key={id}
                to={`/admin?tab=${id}`}
                aria-current={tab === id ? "page" : undefined}
                className={`border-b-2 px-3 pb-3 text-sm font-medium transition-colors ${
                  tab === id
                    ? "border-accent text-foreground"
                    : "border-transparent text-muted hover:text-foreground"
                }`}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
        {tab === "documents" ? (
          <DocumentsPanel page={page} />
        ) : (
          <BookingsPanel page={page} />
        )}
      </section>
    </div>
  );
}

function DocumentsPanel({ page }: { page: number }) {
  const documents = useDocuments(page);
  return (
    <Records tab="documents" query={documents}>
      {(data) => <DocumentsTable data={data} />}
    </Records>
  );
}

function BookingsPanel({ page }: { page: number }) {
  const bookings = useBookings(page);
  return (
    <Records tab="bookings" query={bookings}>
      {(data) => <BookingsTable data={data} />}
    </Records>
  );
}

/** Loading, failure and "page past the end" around one table. */
function Records<TItem>({
  tab,
  query,
  children,
}: {
  tab: string;
  query: {
    data: Page<TItem> | undefined;
    error: unknown;
    isPending: boolean;
    isPlaceholderData: boolean;
    refetch: () => unknown;
  };
  children: (data: Page<TItem>) => ReactNode;
}) {
  if (query.isPending) {
    return (
      <div
        role="status"
        aria-label="Loading records"
        className="h-64 animate-pulse bg-surface"
      />
    );
  }
  if (query.error || !query.data) {
    return (
      <div role="alert" className="p-6">
        <h3 className="font-semibold">Could not load the records</h3>
        <p className="mt-2 text-sm text-muted">{describeError(query.error)}</p>
        <Button className="mt-4" onClick={() => void query.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  // A page past the end (a stale bookmark, a deleted record) goes to the last page.
  const last = lastPageIfBeyond(query.data);
  if (last !== null) {
    return <Navigate to={`/admin?tab=${tab}&page=${last}`} replace />;
  }
  return (
    <div
      aria-busy={query.isPlaceholderData}
      className={query.isPlaceholderData ? "opacity-60 transition-opacity" : ""}
    >
      {children(query.data)}
    </div>
  );
}
