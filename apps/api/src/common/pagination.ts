import { z } from 'zod';

export const MAX_PAGE_SIZE = 100;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface Page<TItem> {
  items: TItem[];
  total: number;
  page: number;
  pageSize: number;
}

export function pageWindow({ page, pageSize }: PaginationQuery): {
  skip: number;
  take: number;
} {
  return { skip: (page - 1) * pageSize, take: pageSize };
}
