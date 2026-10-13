import { z } from "zod";

/** Most files one selection may hold; they are sent in batches. */
export const MAX_UPLOAD_FILES = 100;
/** Files per request; the API accepts up to 10. */
export const UPLOAD_BATCH_SIZE = 5;
export const MAX_UPLOAD_FILE_BYTES = 200 * 1024;

/** What an upload would overwrite: the listing that already owns the slug. */
export const ingestConflictSchema = z.object({
  slug: z.string(),
  existingTitle: z.string(),
  existingFilename: z.string(),
  /** SHA-256 of the stored document; an approval to replace must name it. */
  existingContentHash: z.string(),
  existingUpdatedAt: z.coerce.date(),
  newTitle: z.string(),
});

export type IngestConflict = z.infer<typeof ingestConflictSchema>;

/** The admin's approval to overwrite: the slug and the stored version they saw. */
export type Replacement = Pick<IngestConflict, "slug" | "existingContentHash">;

export const ingestResultSchema = z.object({
  filename: z.string(),
  /** `conflict`: the slug is taken by different content and was not confirmed; nothing was written. */
  outcome: z.enum(["created", "updated", "unchanged", "failed", "conflict"]),
  documentId: z.string().optional(),
  propertySlug: z.string().optional(),
  chunks: z.number().optional(),
  error: z.string().optional(),
  conflict: ingestConflictSchema.optional(),
});

export type IngestResult = z.infer<typeof ingestResultSchema>;

/** The API's outcomes plus `skipped`: the admin chose to keep the existing listing. */
export type UploadOutcome = IngestResult["outcome"] | "skipped";

/** One line of the upload report. */
export interface UploadRow {
  filename: string;
  outcome: UploadOutcome;
  chunks?: number;
  error?: string;
  /** A neutral remark that is not an error, e.g. why a file was skipped. */
  note?: string;
}

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
