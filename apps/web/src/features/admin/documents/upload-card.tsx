import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/shared/ui/button";
import { formatBytes, pluralize } from "@/shared/lib/format";
import { OutcomeBadge } from "../components/status-badge";
import { uploadFiles, useInvalidateDocuments } from "./documents-api";
import { ReplaceConflictsDialog } from "./replace-conflicts-dialog";
import {
  MAX_UPLOAD_FILES,
  MAX_UPLOAD_FILE_BYTES,
  UPLOAD_BATCH_SIZE,
  type UploadRow,
} from "./schemas";
import { runUpload, type PendingConflict } from "./upload-flow";

type Progress = { from: number; to: number; total: number };

type Question = {
  conflicts: PendingConflict[];
  answer: (replace: boolean[]) => void;
};

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

function summarise(rows: UploadRow[]): string {
  const counts = new Map<string, number>();
  for (const { outcome } of rows) {
    counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
  }
  return [...counts].map(([outcome, count]) => `${count} ${outcome}`).join(", ");
}

const fileKey = (file: File) =>
  `${file.name}:${file.size}:${file.lastModified}`;

export function UploadCard() {
  const inputRef = useRef<HTMLInputElement>(null);
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const invalidateDocuments = useInvalidateDocuments();
  const [selected, setSelected] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [question, setQuestion] = useState<Question | null>(null);
  const [rows, setRows] = useState<UploadRow[] | null>(null);
  const [finished, setFinished] = useState(false);
  const [abortMessage, setAbortMessage] = useState<string | null>(null);

  // The dialog or the button that had focus is gone: land on the result.
  useEffect(() => {
    if (finished) summaryRef.current?.focus();
  }, [finished]);

  const validCount = selected.filter((file) => !problemWith(file)).length;
  const tooMany = selected.length > MAX_UPLOAD_FILES;

  function add(files: Iterable<File>) {
    const known = new Set(selected.map(fileKey));
    const additions = [...files].filter((file) => !known.has(fileKey(file)));
    setSelected([...selected, ...additions]);
    // Let the same file be chosen again after it was removed or uploaded.
    if (inputRef.current) inputRef.current.value = "";
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (running || tooMany) return;

    const valid = selected.filter((file) => !problemWith(file));
    if (valid.length === 0) return;
    const rejected: UploadRow[] = selected.flatMap((file) => {
      const problem = problemWith(file);
      return problem
        ? [{ filename: file.name, outcome: "failed" as const, error: problem }]
        : [];
    });

    setAbortMessage(null);
    setFinished(false);
    setRunning(true);
    setRows(rejected);

    // Large selections go in small batches, one after another: each request is
    // short enough not to time out and reports its own progress.
    const outcome = await runUpload(valid, {
      send: uploadFiles,
      decide: (conflicts) => {
        setProgress(null);
        return new Promise((resolve) =>
          setQuestion({ conflicts, answer: resolve }),
        );
      },
      onProgress: setProgress,
      onRows: (uploaded) => setRows([...rejected, ...uploaded]),
    });

    setRows([...rejected, ...outcome.rows]);
    setAbortMessage(outcome.abortMessage);
    setRunning(false);
    setSelected([]);
    setFinished(true);
    void invalidateDocuments();
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
        {UPLOAD_BATCH_SIZE}. A file whose slug already belongs to a listing
        with different content is only uploaded after you confirm replacing it.
      </p>

      <form onSubmit={(event) => void onSubmit(event)} className="mt-4">
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
            disabled={running}
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
            disabled={running || validCount === 0 || tooMany}
          >
            {running
              ? "Uploading and indexing…"
              : validCount > 0
                ? `Upload ${pluralize(validCount, "file")}`
                : "Upload"}
          </Button>
          {selected.length > 0 && !running ? (
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
        {finished && rows ? (
          <p
            ref={summaryRef}
            tabIndex={-1}
            role="status"
            className="text-sm font-medium outline-none"
          >
            Finished: {summarise(rows)}
          </p>
        ) : null}
        {rows && rows.length > 0 ? (
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {rows.map((row, index) => (
              <li key={`${row.filename}:${index}`} className="px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span dir="auto" className="min-w-0 break-words">
                    {row.filename}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {row.chunks !== undefined ? (
                      <span className="text-xs text-muted">
                        {pluralize(row.chunks, "chunk")}
                      </span>
                    ) : null}
                    <OutcomeBadge outcome={row.outcome} />
                  </span>
                </div>
                {row.note ? (
                  <p dir="auto" className="mt-1 text-xs text-muted">
                    {row.note}
                  </p>
                ) : null}
                {row.error ? (
                  <pre
                    dir="auto"
                    className="mt-2 whitespace-pre-wrap break-words rounded-md bg-danger-soft p-3 font-mono text-xs text-danger"
                  >
                    {row.error}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {question ? (
        <ReplaceConflictsDialog
          conflicts={question.conflicts}
          onDecide={(replace) => {
            question.answer(replace);
            setQuestion(null);
          }}
        />
      ) : null}
    </section>
  );
}
