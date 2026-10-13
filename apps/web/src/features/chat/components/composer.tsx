import { useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/shared/ui/button";
import { MAX_MESSAGE_LENGTH } from "@/features/chat/api/chat-schemas";

/** From this length the remaining room is announced to screen readers. */
const NEAR_LIMIT = Math.floor(MAX_MESSAGE_LENGTH * 0.9);
/** Browser-side guard against absurd pastes; the real limit is shown, not enforced silently. */
const HARD_INPUT_CAP = MAX_MESSAGE_LENGTH * 4;

export function Composer({
  busy,
  disabled,
  onSend,
  onStop,
}: {
  busy: boolean;
  disabled: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState("");
  const length = text.length;
  const tooLong = length > MAX_MESSAGE_LENGTH;
  const nearLimit = !tooLong && length >= NEAR_LIMIT;

  const submit = () => {
    if (busy || disabled || tooLong || !text.trim()) return;
    onSend(text);
    setText("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      submit();
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };

  return (
    <form onSubmit={onSubmit} className="border-t border-border p-3">
      <label htmlFor="chat-input" className="sr-only">
        Your message
      </label>
      <textarea
        id="chat-input"
        dir="auto"
        rows={2}
        maxLength={HARD_INPUT_CAP}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        aria-invalid={tooLong}
        aria-describedby="chat-input-status"
        placeholder="Ask about our listings…"
        className="block w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm aria-[invalid=true]:border-red-600"
      />
      <div className="mt-2 flex items-start justify-between gap-2">
        <div className="min-w-0 text-xs">
          <span className="tabular-nums text-muted" aria-hidden="true">
            {length}/{MAX_MESSAGE_LENGTH}
          </span>
          {/* Always mounted so changes are announced politely. */}
          <p
            id="chat-input-status"
            role="status"
            aria-live="polite"
            className={tooLong ? "mt-1 text-red-700 dark:text-red-400" : "sr-only"}
          >
            {tooLong
              ? `Messages are limited to 1,000 characters. Remove ${length - MAX_MESSAGE_LENGTH} to send.`
              : nearLimit
                ? `Close to the limit: ${MAX_MESSAGE_LENGTH - length} characters left.`
                : ""}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {busy ? (
            <Button variant="secondary" onClick={onStop}>
              Stop
            </Button>
          ) : null}
          <Button
            variant="primary"
            type="submit"
            disabled={busy || disabled || tooLong || !text.trim()}
          >
            Send
          </Button>
        </div>
      </div>
    </form>
  );
}
