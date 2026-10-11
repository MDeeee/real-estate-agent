"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { deleteDocument, reindexDocument } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";

type Feedback = { kind: "error" | "success"; text: string };

const SUCCESS_VISIBLE_MS = 4000;

export function DocumentActions({
  id,
  filename,
}: {
  id: string;
  filename: string;
}) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  useEffect(() => {
    if (feedback?.kind !== "success") return;
    const timer = setTimeout(() => setFeedback(null), SUCCESS_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [feedback]);

  function run(
    action: (id: string) => Promise<{ ok: boolean; message?: string }>,
    successText?: string,
  ) {
    setFeedback(null);
    startTransition(async () => {
      const result = await action(id);
      setConfirming(false);
      if (!result.ok) {
        setFeedback({
          kind: "error",
          text: result.message ?? "The action failed.",
        });
      } else if (successText) {
        setFeedback({ kind: "success", text: successText });
      }
    });
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
            onClick={() => run(deleteDocument)}
          >
            {pending ? "Deleting…" : "Confirm"}
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
            onClick={() => run(reindexDocument, "Re-indexed.")}
          >
            {pending ? "Working…" : "Re-index"}
          </Button>
          <Button
            variant="secondary"
            disabled={pending}
            aria-label={`Delete ${filename}`}
            onClick={() => {
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
