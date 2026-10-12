"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_MESSAGE_LENGTH,
  historySchema,
  type ChatBooking,
  type ChatCard,
  type ChatEvent,
  type SearchSummary,
} from "@/lib/chat-schemas";
import { postChat } from "@/lib/chat-request";
import { settleStopped } from "@/lib/chat-stop";
import { readChatStream } from "@/lib/chat-stream";

export type ChatStage = "thinking" | "searching" | "booking";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  properties?: ChatCard[];
  booking?: ChatBooking;
  search?: SearchSummary;
  /** Listings the final answer cited, in citation order (absent while streaming and for restored messages). */
  citedSlugs?: string[];
  streaming?: boolean;
  /** The visitor pressed Stop: a partial reply is kept for now but not stored by the server; on a visitor message it marks one that got no reply. */
  stopped?: boolean;
  error?: string;
}

/** How long restoring the previous conversation may take before starting empty. */
export const RESTORE_TIMEOUT_MS = 5000;

const GENERIC_ERROR = "Something went wrong. Please try again.";
const NEW_CHAT_ERROR = "Could not start a new chat. Please try again.";

let counter = 0;
function nextId(): string {
  counter += 1;
  return `m${counter}`;
}

async function serverMessage(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "message" in body &&
      typeof body.message === "string"
    ) {
      return body.message;
    }
  } catch {
    // No readable body; the status alone decides the message.
  }
  return undefined;
}

/** A friendly, accurate sentence for a refused request. */
async function errorFor(response: Response, text: string): Promise<string> {
  switch (response.status) {
    case 400:
      // Only blame the length when the message really was too long.
      return text.length > MAX_MESSAGE_LENGTH
        ? "Messages are limited to 1,000 characters. Please shorten it and try again."
        : "That message could not be sent. Please check it and try again.";
    case 409:
      return "A reply is still being written. Please wait a moment and try again.";
    case 413:
      return "That message is too large to send.";
    case 429: {
      const message = await serverMessage(response);
      const seconds = Number(response.headers.get("retry-after"));
      if (message?.includes("busy")) return message;
      return Number.isFinite(seconds) && seconds > 0 && seconds <= 3600
        ? `You are sending messages too quickly. Please wait ${Math.ceil(seconds)} seconds and try again.`
        : (message ??
            "You are sending messages too quickly. Please wait a minute and try again.");
    }
    case 503:
      return (
        (await serverMessage(response)) ??
        "The AI assistant is not available right now."
      );
    default:
      return GENERIC_ERROR;
  }
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [stage, setStage] = useState<ChatStage | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);

  // Leaving the page ends a running request quietly.
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      try {
        // The conversation id is an httpOnly cookie; the route reads it.
        const response = await fetch("/api/chat", {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(RESTORE_TIMEOUT_MS),
          ]),
          cache: "no-store",
        });
        if (!response.ok) return;
        const parsed = historySchema.safeParse(await response.json());
        // Aborted meanwhile (Strict Mode remount, leaving the page): not ours.
        if (!parsed.success || controller.signal.aborted) return;
        setMessages(
          parsed.data.messages.map((message) => ({
            id: nextId(),
            ...message,
          })),
        );
      } catch {
        // Failed or too slow: start with an empty conversation.
      } finally {
        if (!controller.signal.aborted) setRestoring(false);
      }
    })();

    return () => controller.abort();
  }, []);

  const patchLast = useCallback(
    (patch: (message: ChatMessage) => ChatMessage) => {
      setMessages((current) => {
        const last = current.at(-1);
        if (!last || last.role !== "assistant") return current;
        return [...current.slice(0, -1), patch(last)];
      });
    },
    [],
  );

  const applyEvent = useCallback(
    (event: ChatEvent) => {
      switch (event.type) {
        case "status":
          setStage(event.stage);
          break;
        case "filters":
          patchLast((m) => ({
            ...m,
            search: { filters: event.filters, semanticQuery: event.semanticQuery },
          }));
          break;
        case "properties":
          patchLast((m) => ({ ...m, properties: event.items }));
          break;
        case "token":
          setStage(null);
          patchLast((m) => ({ ...m, text: m.text + event.text }));
          break;
        case "booking":
          patchLast((m) => ({ ...m, booking: event.booking }));
          break;
        case "final":
          patchLast((m) => ({
            ...m,
            text: event.text,
            citedSlugs: event.citedSlugs,
            streaming: false,
          }));
          break;
        case "error":
          patchLast((m) => ({ ...m, error: event.message, streaming: false }));
          break;
        case "done":
          break;
      }
    },
    [patchLast],
  );

  const send = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!text || busyRef.current) return;

      busyRef.current = true;
      setBusy(true);
      setNotice(null);
      setStage("thinking");
      setMessages((current) => [
        ...current,
        { id: nextId(), role: "user", text },
        { id: nextId(), role: "assistant", text: "", streaming: true },
      ]);

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const response = await postChat(text, controller.signal);
        if (!response.ok || !response.body) {
          const error = await errorFor(response, text);
          patchLast((m) => ({ ...m, error, streaming: false }));
          return;
        }
        await readChatStream(response.body, applyEvent);
        patchLast((m) =>
          m.streaming
            ? { ...m, error: m.error ?? GENERIC_ERROR, streaming: false }
            : m,
        );
      } catch {
        // Stop (or a new chat) aborts the request on purpose: whatever the
        // rejection looks like (AbortError, a stream error, ...), it is not
        // a failure and is never reported as one.
        if (controller.signal.aborted) {
          setMessages((current) => settleStopped(current));
        } else {
          patchLast((m) => ({ ...m, error: GENERIC_ERROR, streaming: false }));
        }
      } finally {
        // Send stays disabled (busy) until the response has really closed.
        abortRef.current = null;
        busyRef.current = false;
        setBusy(false);
        setStage(null);
      }
    },
    [applyEvent, patchLast],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const retry = useCallback(() => {
    if (busyRef.current) return;
    const last = messages.at(-1);
    const previous = messages.at(-2);
    if (last?.role !== "assistant" || !last.error || previous?.role !== "user") {
      return;
    }
    setMessages(messages.slice(0, -2));
    void send(previous.text);
  }, [messages, send]);

  const newChat = useCallback(async () => {
    abortRef.current?.abort();
    setResetting(true);
    setNotice(null);
    try {
      // The server rotates the httpOnly conversation cookie.
      const response = await fetch("/api/chat/reset", { method: "POST" });
      if (!response.ok) throw new Error("reset failed");
      setMessages([]);
      setStage(null);
    } catch {
      setNotice(NEW_CHAT_ERROR);
    } finally {
      setResetting(false);
    }
  }, []);

  return {
    messages,
    stage,
    busy,
    restoring,
    resetting,
    notice,
    send,
    stop,
    retry,
    newChat,
  };
}
