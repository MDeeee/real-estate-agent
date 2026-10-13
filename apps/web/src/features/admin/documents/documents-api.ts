import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { z } from "zod";
import { request, requestVoid } from "@/shared/api/http";
import { pageSchema } from "@/shared/api/page";
import { ADMIN_PAGE_SIZE } from "../constants";
import {
  documentItemSchema,
  ingestResultSchema,
  type IngestResult,
  type Replacement,
} from "./schemas";

export const documentKeys = {
  all: ["admin", "documents"] as const,
  list: (page: number) => [...documentKeys.all, page] as const,
};

export function useDocuments(page: number) {
  return useQuery({
    queryKey: documentKeys.list(page),
    queryFn: ({ signal }) =>
      request(
        `/admin/documents?page=${page}&pageSize=${ADMIN_PAGE_SIZE}`,
        pageSchema(documentItemSchema),
        { signal },
      ),
    placeholderData: keepPreviousData,
  });
}

/**
 * Uploads one request's worth of files (at most `UPLOAD_BATCH_SIZE`). Each file
 * gets its own result. A file whose slug already belongs to a listing with
 * different content comes back as `conflict` and is not written, unless
 * `replacements` approves that slug for the stored version named in the conflict.
 */
export function uploadFiles(
  files: File[],
  replacements: Replacement[] = [],
): Promise<IngestResult[]> {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  for (const { slug, existingContentHash } of replacements) {
    form.append("replacements", JSON.stringify({ slug, existingContentHash }));
  }
  return request("/admin/documents", z.array(ingestResultSchema), {
    method: "POST",
    body: form,
  });
}

/** Refreshes the lists after the documents changed. */
export function useInvalidateDocuments() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: documentKeys.all });
}

export function useReindexDocument() {
  const invalidate = useInvalidateDocuments();
  return useMutation({
    mutationFn: (id: string) =>
      request(
        `/admin/documents/${encodeURIComponent(id)}/reindex`,
        ingestResultSchema,
        { method: "POST" },
      ),
    onSettled: invalidate,
  });
}

export function useDeleteDocument() {
  const invalidate = useInvalidateDocuments();
  return useMutation({
    mutationFn: (id: string) =>
      requestVoid(`/admin/documents/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    onSettled: invalidate,
  });
}
