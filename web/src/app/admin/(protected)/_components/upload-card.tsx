"use client";

import { useActionState, useRef, useState } from "react";
import { uploadDocuments, type UploadState } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import {
  MAX_UPLOAD_FILES,
  MAX_UPLOAD_FILE_BYTES,
  type IngestResult,
} from "@/lib/admin-schemas";
import { formatBytes } from "@/lib/format";
import { OutcomeBadge } from "./status-badge";

const idle: UploadState = { status: "idle" };

function problemWith(file: File): string | null {
  if (!file.name.toLowerCase().endsWith(".md")) return "Not a .md file";
  if (file.size > MAX_UPLOAD_FILE_BYTES) {
    return `Larger than ${MAX_UPLOAD_FILE_BYTES / 1024} KB`;
  }
  return null;
}

function summarise(results: IngestResult[]): string {
  const counts = new Map<string, number>();
  for (const { outcome } of results) {
    counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
  }
  return [...counts].map(([outcome, count]) => `${count} ${outcome}`).join(", ");
}

export function UploadCard() {
  const [state, formAction, pending] = useActionState(uploadDocuments, idle);
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);

  function select(files: File[]) {
    const input = inputRef.current;
    if (!input) return;
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    input.files = transfer.files;
    setSelected(files);
  }

  function addDropped(dropped: FileList) {
    const known = new Set(selected.map((file) => `${file.name}:${file.size}`));
    const additions = Array.from(dropped).filter(
      (file) => !known.has(`${file.name}:${file.size}`),
    );
    select([...selected, ...additions]);
  }

  const tooMany = selected.length > MAX_UPLOAD_FILES;

  return (
    <section
      aria-labelledby="upload-heading"
      className="rounded-xl border border-border bg-surface p-6"
    >
      <h2 id="upload-heading" className="text-lg font-semibold">
        Upload listings
      </h2>
      <p className="mt-1 text-sm text-muted">
        Markdown files with YAML frontmatter. Up to {MAX_UPLOAD_FILES} files,{" "}
        {MAX_UPLOAD_FILE_BYTES / 1024} KB each. Files with the same slug update
        the existing listing.
      </p>

      <form
        action={(formData) => {
          setSelected([]);
          formAction(formData);
        }}
        className="mt-4"
      >
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
            addDropped(event.dataTransfer.files);
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
            name="files"
            type="file"
            multiple
            accept=".md,text/markdown"
            className="sr-only"
            onChange={(event) =>
              setSelected(Array.from(event.currentTarget.files ?? []))
            }
          />
        </label>

        {selected.length > 0 ? (
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border text-sm">
            {selected.map((file) => {
              const problem = problemWith(file);
              return (
                <li
                  key={`${file.name}:${file.size}`}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <span dir="auto" className="min-w-0 break-words">
                    {file.name}
                  </span>
                  <span
                    className={`shrink-0 text-xs ${problem ? "text-danger" : "text-muted"}`}
                  >
                    {problem ?? formatBytes(file.size)}
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
            disabled={pending || selected.length === 0 || tooMany}
          >
            {pending
              ? "Uploading and indexing…"
              : `Upload${selected.length > 0 ? ` ${selected.length} file${selected.length === 1 ? "" : "s"}` : ""}`}
          </Button>
          {selected.length > 0 && !pending ? (
            <Button variant="ghost" onClick={() => select([])}>
              Clear
            </Button>
          ) : null}
        </div>
      </form>

      <div aria-live="polite" className="mt-4">
        {state.status === "error" ? (
          <p
            role="alert"
            className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger"
          >
            {state.message}
          </p>
        ) : null}
        {state.status === "done" ? (
          <div>
            <p className="text-sm font-medium">
              Finished: {summarise(state.results)}
            </p>
            <ul className="mt-2 divide-y divide-border rounded-lg border border-border text-sm">
              {state.results.map((result, index) => (
                <li key={`${result.filename}:${index}`} className="px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <span dir="auto" className="min-w-0 break-words">
                      {result.filename}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {result.chunks !== undefined ? (
                        <span className="text-xs text-muted">
                          {result.chunks} chunks
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
          </div>
        ) : null}
      </div>
    </section>
  );
}
