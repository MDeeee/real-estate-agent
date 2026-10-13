import { describeError } from "@/shared/api/http";
import {
  UPLOAD_BATCH_SIZE,
  type IngestConflict,
  type Replacement,
  type IngestResult,
  type UploadRow,
} from "./schemas";

/** A file the API refused to write because its slug already belongs to another listing. */
export interface PendingConflict {
  file: File;
  conflict: IngestConflict;
}

export interface UploadFlowDeps {
  /** One request: at most `UPLOAD_BATCH_SIZE` files, with the stored versions the admin agreed to replace. */
  send: (files: File[], replacements: Replacement[]) => Promise<IngestResult[]>;
  /** Asks the admin. Resolves with one answer per conflict: `true` replaces the existing listing. */
  decide: (conflicts: PendingConflict[]) => Promise<boolean[]>;
  /** Which files are being sent now (1-based, inclusive), or null when idle. */
  onProgress?: (progress: { from: number; to: number; total: number } | null) => void;
  /** Called with the report so far, in file order, every time it grows. */
  onRows?: (rows: UploadRow[]) => void;
}

export interface UploadFlowResult {
  rows: UploadRow[];
  /** Set when a request failed and the remaining files were not sent. */
  abortMessage: string | null;
}

const INTERRUPTED_MESSAGE =
  "The upload was interrupted. Check your connection and try again.";

function rowFor(file: File, result: IngestResult | undefined): UploadRow {
  if (!result) {
    return {
      filename: file.name,
      outcome: "failed",
      error: "The API sent no result for this file.",
    };
  }
  return {
    filename: result.filename,
    outcome: result.outcome,
    chunks: result.chunks,
    error: result.error,
    note: result.conflict
      ? `The slug "${result.conflict.slug}" already belongs to another listing.`
      : undefined,
  };
}

/**
 * Uploads files in batches of `UPLOAD_BATCH_SIZE` and reports one row per file.
 *
 * A slug is a listing's identity, so a file that would overwrite an existing
 * listing with different content is not written; the API answers `conflict`.
 * After the first pass the admin decides, per file, whether to replace; only
 * the approved files are sent again, each approval naming the exact stored
 * version the admin saw (if the listing changed since, the API answers
 * `conflict` again and nothing is overwritten). When a request fails before the
 * first pass is over, the conflicts found so far are not asked about: those
 * files are reported as not uploaded.
 */
export async function runUpload(
  files: File[],
  { send, decide, onProgress, onRows }: UploadFlowDeps,
): Promise<UploadFlowResult> {
  const rows: (UploadRow | undefined)[] = files.map(() => undefined);
  const conflicts = new Map<number, IngestConflict>();
  let abortMessage: string | null = null;

  const publish = () =>
    onRows?.(rows.filter((row): row is UploadRow => row !== undefined));

  /** Sends the files at `indexes`, batch by batch. False when a request failed. */
  async function sendAll(
    indexes: number[],
    replacementsFor: (index: number) => Replacement[],
  ): Promise<boolean> {
    for (let start = 0; start < indexes.length; start += UPLOAD_BATCH_SIZE) {
      const batch = indexes.slice(start, start + UPLOAD_BATCH_SIZE);
      onProgress?.({
        from: start + 1,
        to: start + batch.length,
        total: indexes.length,
      });
      try {
        const results = await send(
          batch.map((index) => files[index] as File),
          batch.flatMap(replacementsFor),
        );
        batch.forEach((index, position) => {
          rows[index] = rowFor(files[index] as File, results[position]);
          const conflict = results[position]?.conflict;
          if (conflict) conflicts.set(index, conflict);
        });
        publish();
      } catch (error) {
        abortMessage = describeError(error, INTERRUPTED_MESSAGE);
        for (const index of indexes.slice(start)) {
          rows[index] = {
            filename: (files[index] as File).name,
            outcome: "failed",
            error: `Not uploaded: ${abortMessage}`,
          };
        }
        publish();
        return false;
      }
    }
    return true;
  }

  try {
    const all = files.map((_, index) => index);
    const completed = await sendAll(all, () => []);

    const open = [...conflicts.keys()];
    const approvals = new Map<number, Replacement>(
      open.map((index) => {
        const { slug, existingContentHash } = conflicts.get(
          index,
        ) as IngestConflict;
        return [index, { slug, existingContentHash }];
      }),
    );
    if (open.length > 0) {
      const answers = completed
        ? await decide(
            open.map((index) => ({
              file: files[index] as File,
              conflict: conflicts.get(index) as IngestConflict,
            })),
          )
        : [];
      const approved = open.filter((_, position) => answers[position] === true);

      for (const index of open) {
        if (approved.includes(index)) continue;
        const existing = conflicts.get(index) as IngestConflict;
        const filename = (files[index] as File).name;
        rows[index] = completed
          ? {
              filename,
              outcome: "skipped",
              note: `Kept the existing listing "${existing.existingTitle}" (${existing.slug}).`,
            }
          : {
              // The admin was never asked: do not claim they chose to keep it.
              filename,
              outcome: "failed",
              error: `Not uploaded: the upload was interrupted before you could confirm replacing "${existing.existingTitle}" (${existing.slug}). Upload this file again.`,
            };
      }
      conflicts.clear();
      publish();

      if (approved.length > 0) {
        await sendAll(approved, (index) => [approvals.get(index) as Replacement]);
        for (const index of approved) {
          if (rows[index]?.outcome !== "conflict") continue;
          rows[index] = {
            filename: (files[index] as File).name,
            outcome: "failed",
            error: "The listing changed while uploading. Upload this file again.",
          };
        }
        publish();
      }
    }
  } finally {
    onProgress?.(null);
  }

  return {
    rows: rows.filter((row): row is UploadRow => row !== undefined),
    abortMessage,
  };
}
