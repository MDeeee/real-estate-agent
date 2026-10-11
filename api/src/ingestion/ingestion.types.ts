export const MAX_FILE_BYTES = 200 * 1024;
export const MAX_FILES_PER_REQUEST = 10;

export type IngestOutcome = 'created' | 'updated' | 'unchanged' | 'failed';

export interface IngestResult {
  filename: string;
  outcome: IngestOutcome;
  documentId?: string;
  propertySlug?: string;
  chunks?: number;
  error?: string;
}

export interface UploadedFile {
  originalname: string;
  size: number;
  buffer: Buffer;
}
