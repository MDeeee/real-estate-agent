"use client";

import { useRef, useState, type FormEvent } from "react";
import { uploadDocumentBatch, type UploadBatchState } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import {
  MAX_UPLOAD_FILES,
  MAX_UPLOAD_FILE_BYTES,
  UPLOAD_BATCH_SIZE,
  type IngestResult,
} from "@/lib/admin-schemas";
import { formatBytes, pluralize } from "@/lib/format";
import { OutcomeBadge } from "./status-badge";

type Progress = { from: number; to: number; total: number };

const INTERRUPTED_MESSAGE =
  "The upload was interrupted. Check your connection and try again.";

/** Why a file will not be sent, or null when it is fine to upload. */
function problemWith(file: File): string | null {
  if (!file.name.toLowerCase().endsWith(".md")) {
    return "only .md files are accepted";
  }
  if (file.size === 0) return "empty file";
  if (file.size > MAX_UPLOAD_FILE_BYTES) {
    return `larger than ${MAX_UPLOAD_FILE_BYTES / 1024} KB`;
  }
  return null;
}

function failedRow(file: File, error: string): IngestResult {
  return { filename: file.name, outcome: "failed", error };
}

function summarise(results: IngestResult[]): string {
  const counts = new Map<string, number>();
  for (const { outcome } of results) {
    counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
  }
  return [...counts].map(([outcome, count]) => `${count} ${outcome}`).join(", ");
}

const fileKey = (file: File) =>
  `${file.name}:${file.size}:${file.lastModified}`;

export function UploadCard() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [results, setResults] = useState<IngestResult[] | null>(null);
  const [finished, setFinished] = useState(false);
  const [abortMessage, setAbortMessage] = useState<string | null>(null);

  const uploading = progress !== null;
  const validCount = selected.filter((file) => !problemWith(file)).length;
  const tooMany = selected.length > MAX_UPLOAD_FILES;

  function add(files: Iterable<File>) {
    const known = new Set(selected.map(fileKey));
    const additions = [...files].filter((file) => !known.has(fileKey(file)));
    setSelected([...selected, ...additions]);
    // Let the same file be chosen again after it was removed or uploaded.
    if (inputRef.current) inputRef.current.value = "";
  }

  async function sendBatch(batch: File[]): Promise<UploadBatchState> {
    const form = new FormData();
    for (const file of batch) form.append("files", file, file.name);
    try {
      return await uploadDocumentBatch(form);
    } catch {
      return { status: "error", message: INTERRUPTED_MESSAGE };
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (uploading || tooMany) return;

    const valid = selected.filter((file) => !problemWith(file));
    if (valid.length === 0) return;
    const skipped = selected.flatMap((file) => {
      const problem = problemWith(file);
      return problem ? [failedRow(file, problem)] : [];
    });

    setAbortMessage(null);
    setFinished(false);
    setResults(skipped);

    // Server actions cannot stream, so send small batches one after another;
    // each call is short enough not to time out and reports its own progress.
    for (let start = 0; start < valid.length; start += UPLOAD_BATCH_SIZE) {
      const batch = valid.slice(start, start + UPLOAD_BATCH_SIZE);
      setProgress({
        from: start + 1,
        to: start + batch.length,
        total: valid.length,
      });

      const outcome = await sendBatch(batch);
      if (outcome.status === "error") {
        const notSent = valid
          .slice(start)
          .map((file) => failedRow(file, `Not uploaded: ${outcome.message}`));
        setResults((previous) => [...(previous ?? []), ...notSent]);
        setAbortMessage(outcome.message);
        break;
      }
      setResults((previous) => [...(previous ?? []), ...outcome.results]);
    }

    setProgress(null);
    setSelected([]);
    setFinished(true);
  }

  return (
    <section
      aria-labelledby="upload-heading"
      className="rounded-xl border border-border bg-surface p-6"
    >
      <h2 id="upload-heading" className="text-lg font-semibold">
        Upload listings
      </h2>
      <p className="mt-1 text-sm text-muted">
        Markdown files with YAML frontmatter, {MAX_UPLOAD_FILE_BYTES / 1024} KB
        each at most. Large selections are uploaded in batches of{" "}
        {UPLOAD_BATCH_SIZE}. Files with the same slug update the existing
        listing.
      </p>

      <form onSubmit={onSubmit} className="mt-4">
        <label
          htmlFor="files"
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            add(Array.from(event.dataTransfer.files));
          }}
          className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
            dragging
              ? "border-accent bg-accent/10"
              : "border-border hover:border-accent"
          }`}
        >
          <span className="text-sm font-medium">
            Drop .md files here or click to browse
          </span>
          <span className="text-xs text-muted">
            You can select several files at once
          </span>
          <input
            ref={inputRef}
            id="files"
            type="file"
            multiple
            accept=".md,text/markdown"
            disabled={uploading}
            className="sr-only"
            onChange={(event) => add(Array.from(event.currentTarget.files ?? []))}
          />
        </label>

        {selected.length > 0 ? (
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border text-sm">
            {selected.map((file) => {
              const problem = problemWith(file);
              return (
                <li
                  key={fileKey(file)}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <span dir="auto" className="min-w-0 break-words">
                    {file.name}
                  </span>
                  <span
                    className={`shrink-0 text-xs ${problem ? "text-danger" : "text-muted"}`}
                  >
                    {problem ? `Skipped: ${problem}` : formatBytes(file.size)}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}

        {tooMany ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            Select at most {MAX_UPLOAD_FILES} files per upload.
          </p>
        ) : null}

        <div className="mt-4 flex items-center gap-3">
          <Button
            type="submit"
            variant="primary"
            disabled={uploading || validCount === 0 || tooMany}
          >
            {uploading
              ? "Uploading and indexing…"
              : validCount > 0
                ? `Upload ${pluralize(validCount, "file")}`
                : "Upload"}
          </Button>
          {selected.length > 0 && !uploading ? (
            <Button variant="ghost" onClick={() => setSelected([])}>
              Clear
            </Button>
          ) : null}
        </div>
      </form>

      <div className="mt-4 space-y-3">
        {progress ? (
          <p role="status" className="text-sm text-muted">
            Uploading {progress.from}–{progress.to} of {progress.total}…
          </p>
        ) : null}
        {abortMessage ? (
          <p
            role="alert"
            className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger"
          >
            {abortMessage}
          </p>
        ) : null}
        {finished && results ? (
          <p role="status" className="text-sm font-medium">
            Finished: {summarise(results)}
          </p>
        ) : null}
        {results && results.length > 0 ? (
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {results.map((result, index) => (
              <li key={`${result.filename}:${index}`} className="px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span dir="auto" className="min-w-0 break-words">
                    {result.filename}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {result.chunks !== undefined ? (
                      <span className="text-xs text-muted">
                        {pluralize(result.chunks, "chunk")}
                      </span>
                    ) : null}
                    <OutcomeBadge outcome={result.outcome} />
                  </span>
                </div>
                {result.error ? (
                  <pre
                    dir="auto"
                    className="mt-2 whitespace-pre-wrap break-words rounded-md bg-danger-soft p-3 font-mono text-xs text-danger"
                  >
                    {result.error}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
