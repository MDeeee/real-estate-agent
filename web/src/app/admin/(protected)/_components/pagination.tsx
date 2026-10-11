import Link from "next/link";
import { buttonClass } from "@/components/ui/button";

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
  const pages = Math.max(1, Math.ceil(total / pageSize));
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
          <Link href={href(page - 1)} className={buttonClass("secondary")}>
            Previous
          </Link>
        ) : null}
        {page < pages ? (
          <Link href={href(page + 1)} className={buttonClass("secondary")}>
            Next
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
