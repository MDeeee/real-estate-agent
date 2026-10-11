/**
 * Placeholders for the filter form and the results. They are direct children
 * of the page grid (like the real components), so the mobile order matches.
 */
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
        className="order-2 grid min-w-0 gap-4 sm:grid-cols-2 lg:order-none xl:grid-cols-3"
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
