"use client";

import { SiteHeader } from "./_components/site-header";
import { Button } from "@/components/ui/button";

export default function HomeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-16 sm:px-6">
        <div
          role="alert"
          className="rounded-xl border border-border bg-surface p-6"
        >
          <h1 className="text-xl font-semibold">Could not load properties</h1>
          <p className="mt-2 text-sm text-muted">
            {error.message || "An unexpected error occurred."}
          </p>
          <Button className="mt-4" onClick={reset}>
            Try again
          </Button>
        </div>
      </main>
    </>
  );
}
