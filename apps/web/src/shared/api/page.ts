import { z } from "zod";

/** The API's paginated list envelope. */
export function pageSchema<TItem extends z.ZodType>(item: TItem) {
  return z.object({
    items: z.array(item),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
  });
}

export type Page<TItem> = {
  items: TItem[];
  total: number;
  page: number;
  pageSize: number;
};
