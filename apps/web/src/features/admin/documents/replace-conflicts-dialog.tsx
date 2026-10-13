import { useEffect, useRef, useState, type FormEvent } from "react";
import { formatDateTime } from "@/shared/lib/format";
import { Button } from "@/shared/ui/button";
import type { PendingConflict } from "./upload-flow";

/**
 * Asks, per file, whether an upload may replace the listing that owns its
 * slug. Nothing has been written yet when this opens. Every file starts on
 * "Skip": replacing must be a deliberate choice.
 *
 * It is a native modal `<dialog>`: the browser traps focus inside, makes the
 * page behind it inert and closes it on Escape (treated as "Skip all"). The
 * heading takes focus on open so a screen reader announces the question.
 */
export function ReplaceConflictsDialog({
  conflicts,
  onDecide,
}: {
  conflicts: PendingConflict[];
  /** One answer per conflict, in order: `true` replaces the existing listing. */
  onDecide: (replace: boolean[]) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [replace, setReplace] = useState<boolean[]>(() =>
    conflicts.map(() => false),
  );
  const replaceCount = replace.filter(Boolean).length;

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    headingRef.current?.focus();
    return () => dialog?.close();
  }, []);

  const setAll = (value: boolean) => setReplace(conflicts.map(() => value));
  const setOne = (index: number, value: boolean) =>
    setReplace((current) =>
      current.map((existing, position) => (position === index ? value : existing)),
    );

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onDecide(replace);
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="replace-title"
      aria-describedby="replace-description"
      onCancel={(event) => {
        event.preventDefault();
        onDecide(conflicts.map(() => false));
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-2xl rounded-xl border border-border bg-surface p-0 text-foreground backdrop:bg-black/50"
    >
      <form onSubmit={onSubmit} className="flex max-h-[85dvh] flex-col">
        <div className="px-4 pt-4 sm:px-6 sm:pt-6">
          <h2
            id="replace-title"
            ref={headingRef}
            tabIndex={-1}
            className="text-lg font-semibold outline-none"
          >
            Replace existing{" "}
            {conflicts.length === 1 ? "listing" : `listings (${conflicts.length})`}?
          </h2>
          <p id="replace-description" className="mt-1 text-sm text-muted">
            {conflicts.length === 1
              ? "This file uses a slug that already belongs to a listing with different content."
              : "These files use slugs that already belong to listings with different content."}{" "}
            Nothing has been changed yet. Replacing keeps the listing&apos;s
            bookings and re-indexes its text.
          </p>
        </div>

        <ul className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto px-4 sm:px-6">
          {conflicts.map(({ file, conflict }, index) => (
            <li key={`${file.name}:${index}`}>
              <fieldset className="rounded-lg border border-border p-3">
                <legend className="px-1 text-sm">
                  Slug <strong dir="ltr">{conflict.slug}</strong> already exists
                  (<span dir="auto">&ldquo;{conflict.existingTitle}&rdquo;</span>, from
                  file <span dir="auto">{conflict.existingFilename}</span>, updated{" "}
                  {formatDateTime(conflict.existingUpdatedAt)}). Replace with{" "}
                  <span dir="auto">&ldquo;{conflict.newTitle}&rdquo;</span> from{" "}
                  <span dir="auto">{file.name}</span>?
                </legend>
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={`replace-${index}`}
                      checked={replace[index] === true}
                      onChange={() => setOne(index, true)}
                    />
                    Replace
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={`replace-${index}`}
                      checked={replace[index] !== true}
                      onChange={() => setOne(index, false)}
                    />
                    Skip
                  </label>
                </div>
              </fieldset>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex flex-col gap-2 border-t border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex gap-2">
            <Button className="flex-1 sm:flex-none" onClick={() => setAll(true)}>
              Replace all
            </Button>
            <Button className="flex-1 sm:flex-none" onClick={() => setAll(false)}>
              Skip all
            </Button>
          </div>
          <Button type="submit" variant="primary">
            {replaceCount === 0
              ? "Continue without replacing"
              : `Replace ${replaceCount}, skip ${conflicts.length - replaceCount}`}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
