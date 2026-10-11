"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { deleteDocument, reindexDocument } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";

export function DocumentActions({
  id,
  filename,
}: {
  id: string;
  filename: string;
}) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  function run(action: (id: string) => Promise<{ ok: boolean; message?: string }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await action(id);
      setConfirming(false);
      if (!result.ok) setMessage(result.message ?? "The action failed.");
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
            disabled={pending}
            aria-label={`Re-index ${filename}`}
            onClick={() => run(reindexDocument)}
          >
            {pending ? "Working…" : "Re-index"}
          </Button>
          <Button
            variant="secondary"
            disabled={pending}
            aria-label={`Delete ${filename}`}
            onClick={() => {
              setMessage(null);
              setConfirming(true);
            }}
          >
            Delete
          </Button>
        </div>
      )}
      <p
        role="status"
        aria-live="polite"
        className={message ? "max-w-xs text-right text-xs text-danger" : "sr-only"}
      >
        {message}
      </p>
    </div>
  );
}
