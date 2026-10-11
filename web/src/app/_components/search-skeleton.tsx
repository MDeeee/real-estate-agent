export function SearchSkeleton() {
  return (
    <div role="status" aria-label="Loading properties" className="space-y-6">
      <div className="h-56 animate-pulse rounded-xl border border-border bg-surface" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            className="h-64 animate-pulse rounded-xl border border-border bg-surface"
          />
        ))}
      </div>
    </div>
  );
}
