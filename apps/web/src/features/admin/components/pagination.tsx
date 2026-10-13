import { Link } from "react-router";
import { pageCount } from "@/shared/lib/pagination";
import { buttonClass } from "@/shared/ui/button";

export function Pagination({
  tab,
  page,
  pageSize,
  total,
}: {
  tab: string;
  page: number;
  pageSize: number;
  total: number;
}) {
  const pages = pageCount(total, pageSize);
  const href = (target: number) => `/admin?tab=${tab}&page=${target}`;

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between gap-4 border-t border-border px-4 py-3 text-sm text-muted"
    >
      <p>
        Page {page} of {pages} &middot; {total} total
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link to={href(page - 1)} className={buttonClass("secondary")}>
            Previous
          </Link>
        ) : null}
        {page < pages ? (
          <Link to={href(page + 1)} className={buttonClass("secondary")}>
            Next
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
