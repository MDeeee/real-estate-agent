export const MAX_FILE_BYTES = 200 * 1024;
export const MAX_FILES_PER_REQUEST = 10;

/**
 * `conflict`: the slug already belongs to a listing with different content and
 * the request did not confirm replacing it. Nothing was written.
 */
export type IngestOutcome =
  'created' | 'updated' | 'unchanged' | 'failed' | 'conflict';

/** What an upload would overwrite, so the admin can decide. */
export interface IngestConflict {
  slug: string;
  existingTitle: string;
  existingFilename: string;
  /** SHA-256 of the existing document: the version an approval to replace must name. */
  existingContentHash: string;
  /** ISO 8601 time the existing document was last written. */
  existingUpdatedAt: string;
  newTitle: string;
}

export interface IngestResult {
  filename: string;
  outcome: IngestOutcome;
  documentId?: string;
  propertySlug?: string;
  chunks?: number;
  error?: string;
  conflict?: IngestConflict;
}

export interface UploadOptions {
  /**
   * What the admin approved replacing: slug -> `existingContentHash` of the
   * version they saw in the conflict. An approval only holds while the stored
   * document still has that hash, otherwise the upload is a conflict again. A
   * slug that is not in the upload is ignored.
   */
  replacements?: ReadonlyMap<string, string>;
}

export interface UploadedFile {
  originalname: string;
  size: number;
  buffer: Buffer;
}
