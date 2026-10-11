"use client";

import { Button } from "@/components/ui/button";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-border bg-surface p-6"
    >
      <h2 className="text-lg font-semibold">Could not load the admin area</h2>
      <p className="mt-2 text-sm text-muted">
        {error.message || "An unexpected error occurred."}
      </p>
      <Button className="mt-4" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
