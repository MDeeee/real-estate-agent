import { z } from "zod";

/** Most files one selection may hold; they are sent in batches. */
export const MAX_UPLOAD_FILES = 100;
/** Files per server-action call; the API accepts up to 10 per request. */
export const UPLOAD_BATCH_SIZE = 5;
export const MAX_UPLOAD_FILE_BYTES = 200 * 1024;

export const ingestResultSchema = z.object({
  filename: z.string(),
  outcome: z.enum(["created", "updated", "unchanged", "failed"]),
  documentId: z.string().optional(),
  propertySlug: z.string().optional(),
  chunks: z.number().optional(),
  error: z.string().optional(),
});

export type IngestResult = z.infer<typeof ingestResultSchema>;

export const documentStatusSchema = z.enum(["PENDING", "INDEXED", "FAILED"]);

export type DocumentStatus = z.infer<typeof documentStatusSchema>;

export const documentItemSchema = z.object({
  id: z.string(),
  filename: z.string(),
  status: documentStatusSchema,
  error: z.string().nullable(),
  property: z.object({ slug: z.string(), title: z.string() }).nullable(),
  chunkCount: z.number(),
  updatedAt: z.coerce.date(),
});

export type DocumentItem = z.infer<typeof documentItemSchema>;

export const bookingItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  preferredDate: z.coerce.date(),
  status: z.enum(["CONFIRMED", "CANCELLED"]),
  createdAt: z.coerce.date(),
  property: z.object({ slug: z.string(), title: z.string() }),
});

export type BookingItem = z.infer<typeof bookingItemSchema>;

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
