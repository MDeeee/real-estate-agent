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
import { applyEventToMessage } from "@/lib/chat-message-events";
import { postChat } from "@/lib/chat-request";
import { ResetGate } from "@/lib/chat-reset";
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
  const gateRef = useRef(new ResetGate());
  /** Bumped by "New chat": a request of an earlier conversation stops touching the screen. */
  const generationRef = useRef(0);

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
      if (event.type === "status") setStage(event.stage);
      else if (event.type === "token" || event.type === "booking") {
        setStage(null);
      }
      patchLast((m) => applyEventToMessage(m, event));
    },
    [patchLast],
  );

  const send = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!text || busyRef.current) return;

      const generation = generationRef.current;
      const current = () => generation === generationRef.current;
      const userId = nextId();
      const replyId = nextId();
      busyRef.current = true;
      setBusy(true);
      setNotice(null);
      setStage("thinking");
      setMessages((existing) => [
        ...existing,
        { id: userId, role: "user", text },
        { id: replyId, role: "assistant", text: "", streaming: true },
      ]);

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        // A "New chat" still rotating the conversation cookie: wait for it, so
        // this message starts the new conversation, not the old one.
        if (!(await gateRef.current.whenReady())) {
          setMessages((existing) =>
            existing.filter(({ id }) => id !== userId && id !== replyId),
          );
          return;
        }
        const response = await postChat(text, controller.signal);
        if (!response.ok || !response.body) {
          const error = await errorFor(response, text);
          if (current()) patchLast((m) => ({ ...m, error, streaming: false }));
          return;
        }
        await readChatStream(response.body, (event) => {
          if (current()) applyEvent(event);
        });
        if (current()) {
          patchLast((m) =>
            m.streaming
              ? { ...m, error: m.error ?? GENERIC_ERROR, streaming: false }
              : m,
          );
        }
      } catch {
        // Stop (or a new chat) aborts the request on purpose: whatever the
        // rejection looks like (AbortError, a stream error, ...), it is not
        // a failure and is never reported as one.
        if (!current()) return;
        if (controller.signal.aborted) {
          setMessages((existing) => settleStopped(existing));
        } else {
          patchLast((m) => ({ ...m, error: GENERIC_ERROR, streaming: false }));
        }
      } finally {
        // Send stays disabled (busy) until the response has really closed;
        // "New chat" has already released it for the new conversation.
        if (current()) {
          abortRef.current = null;
          busyRef.current = false;
          setBusy(false);
          setStage(null);
        }
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
    // Optimistic: the screen is empty and the composer usable at once. A
    // message sent meanwhile waits for the reset (see `send`).
    const previous = messages;
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    busyRef.current = false;
    setBusy(false);
    setMessages([]);
    setStage(null);
    setNotice(null);
    setResetting(true);
    const ok = await gateRef.current.begin(async () => {
      // The server rotates the httpOnly conversation cookie.
      const response = await fetch("/api/chat/reset", { method: "POST" });
      return response.ok;
    });
    setResetting(false);
    if (!ok) {
      // Still the old conversation on the server: show it again.
      setMessages((existing) => [...previous, ...existing]);
      setNotice(NEW_CHAT_ERROR);
    }
  }, [messages]);

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
