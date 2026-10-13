import { useEffect, useRef, useState } from "react";
import { describeError } from "@/shared/api/http";
import { Button } from "@/shared/ui/button";
import { useDeleteDocument, useReindexDocument } from "./documents-api";

type Feedback = { kind: "error" | "success"; text: string };

const SUCCESS_VISIBLE_MS = 4000;

export function DocumentActions({
  id,
  filename,
  activeRowId,
  onActivate,
}: {
  id: string;
  filename: string;
  /** The row whose action started last; another row's message is stale once it changes. */
  activeRowId?: string | null;
  /** Called when an action of this row starts. */
  onActivate?: (id: string) => void;
}) {
  const reindex = useReindexDocument();
  const remove = useDeleteDocument();
  const pending = reindex.isPending || remove.isPending;
  const [confirming, setConfirming] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  // A different row's action started: this row's message no longer belongs on
  // screen. Adjusted while rendering, so a message that arrives later stays.
  const [seenActiveRowId, setSeenActiveRowId] = useState(activeRowId);
  if (seenActiveRowId !== activeRowId) {
    setSeenActiveRowId(activeRowId);
    if (activeRowId != null && activeRowId !== id) setFeedback(null);
  }

  useEffect(() => {
    if (feedback?.kind !== "success") return;
    const timer = setTimeout(() => setFeedback(null), SUCCESS_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [feedback]);

  async function onReindex() {
    onActivate?.(id);
    setFeedback(null);
    try {
      const result = await reindex.mutateAsync(id);
      setFeedback(
        result.outcome === "failed"
          ? { kind: "error", text: result.error ?? "Re-indexing failed." }
          : { kind: "success", text: "Re-indexed." },
      );
    } catch (error) {
      setFeedback({ kind: "error", text: describeError(error) });
    }
  }

  async function onDelete() {
    onActivate?.(id);
    setFeedback(null);
    try {
      await remove.mutateAsync(id);
    } catch (error) {
      setFeedback({ kind: "error", text: describeError(error) });
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {confirming ? (
        <div
          role="group"
          aria-label={`Confirm deleting ${filename}`}
          className="flex flex-wrap items-center justify-end gap-2"
        >
          <span className="text-sm text-foreground">Delete this document?</span>
          <Button
            ref={confirmRef}
            variant="danger"
            disabled={pending}
            onClick={() => void onDelete()}
          >
            {remove.isPending ? "Deleting…" : "Confirm"}
          </Button>
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button
            className="whitespace-nowrap"
            disabled={pending}
            aria-label={`Re-index ${filename}`}
            onClick={() => void onReindex()}
          >
            {reindex.isPending ? "Working…" : "Re-index"}
          </Button>
          <Button
            variant="secondary"
            disabled={pending}
            aria-label={`Delete ${filename}`}
            onClick={() => {
              onActivate?.(id);
              setFeedback(null);
              setConfirming(true);
            }}
          >
            Delete
          </Button>
        </div>
      )}
      {/* Live regions stay mounted so screen readers announce later changes. */}
      <p
        role="alert"
        className="max-w-xs text-right text-xs text-danger empty:hidden"
      >
        {feedback?.kind === "error" ? feedback.text : null}
      </p>
      <p
        role="status"
        className="max-w-xs text-right text-xs text-success empty:hidden"
      >
        {feedback?.kind === "success" ? feedback.text : null}
      </p>
    </div>
  );
}
