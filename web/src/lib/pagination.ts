export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * The page to send the visitor to when `page` is beyond the last one, or null
 * when the requested page exists (or there is nothing to page through).
 */
export function lastPageIfBeyond({
  page,
  total,
  pageSize,
}: {
  page: number;
  total: number;
  pageSize: number;
}): number | null {
  if (total === 0) return null;
  const last = pageCount(total, pageSize);
  return page > last ? last : null;
}
