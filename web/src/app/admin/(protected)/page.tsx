import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { fetchBookings, fetchDocuments } from "@/lib/admin-api";
import { lastPageIfBeyond } from "@/lib/pagination";
import { BookingsTable } from "./_components/bookings-table";
import { DocumentsTable } from "./_components/documents-table";
import { UploadCard } from "./_components/upload-card";

export const metadata = { title: "Admin | Real-estate AI agent" };

const PAGE_SIZE = 20;

const querySchema = z.object({
  tab: z.enum(["documents", "bookings"]).catch("documents"),
  page: z.coerce.number().int().min(1).catch(1),
});

const tabs = [
  { id: "documents", label: "Documents" },
  { id: "bookings", label: "Bookings" },
] as const;

/** A page past the end (a stale bookmark, a deleted record) goes to the last page. */
function redirectPastLastPage(
  data: { page: number; total: number; pageSize: number },
  tab: string,
): void {
  const last = lastPageIfBeyond(data);
  if (last !== null) redirect(`/admin?tab=${tab}&page=${last}`);
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default function AdminPage({ searchParams }: PageProps<"/admin">) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Admin</h1>
        <p className="mt-2 text-muted">
          Upload property listings, check their indexing status and review
          viewing bookings.
        </p>
      </div>
      <UploadCard />
      <Suspense fallback={<DashboardSkeleton />}>
        <Dashboard searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Dashboard({
  searchParams,
}: {
  searchParams: PageProps<"/admin">["searchParams"];
}) {
  const raw = await searchParams;
  const { tab, page } = querySchema.parse({
    tab: firstValue(raw.tab),
    page: firstValue(raw.page),
  });

  return (
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
              href={`/admin?tab=${id}`}
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
        <DocumentsTable data={await loadDocuments(page)} />
      ) : (
        <BookingsTable data={await loadBookings(page)} />
      )}
    </section>
  );
}

async function loadDocuments(page: number) {
  const data = await fetchDocuments(page, PAGE_SIZE);
  redirectPastLastPage(data, "documents");
  return data;
}

async function loadBookings(page: number) {
  const data = await fetchBookings(page, PAGE_SIZE);
  redirectPastLastPage(data, "bookings");
  return data;
}

function DashboardSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading records"
      className="h-64 animate-pulse rounded-xl border border-border bg-surface"
    />
  );
}
