/** Placeholders for the filter form and the results. */
export function SearchSkeleton() {
  return (
    <>
      <div
        role="status"
        aria-label="Loading filters"
        className="h-56 animate-pulse rounded-xl border border-border bg-surface"
      />
      <div
        role="status"
        aria-label="Loading properties"
        className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3"
      >
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            className="h-64 animate-pulse rounded-xl border border-border bg-surface"
          />
        ))}
      </div>
    </>
  );
}
