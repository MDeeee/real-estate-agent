import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@/shared/ui/button";
import { MessageItem } from "./message-item";
import type { ChatMessage, ChatStage } from "../types";

/** Closer than this to the bottom counts as "at the bottom": new content keeps it there. */
export const STICK_TO_BOTTOM_PX = 80;

/** A smooth jump is given this long to land before scroll events count as the reader's again. */
const JUMP_SETTLE_MS = 1000;

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function scrollToBottom(list: HTMLElement, smooth: boolean) {
  const top = list.scrollHeight;
  if (typeof list.scrollTo === "function") {
    list.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
  } else {
    list.scrollTop = top;
  }
}

export function MessageList({
  messages,
  stage,
  busy,
  empty,
  onRetry,
  onOpenSearch,
}: {
  messages: ChatMessage[];
  stage: ChatStage | null;
  busy: boolean;
  empty: ReactNode;
  onRetry: () => void;
  onOpenSearch: (href: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const jumpingRef = useRef(false);
  const jumpTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  /** New content pulls the list down: the reader is at the bottom (or just sent something). */
  const [following, setFollowing] = useState(true);
  /** Content arrived while the reader was scrolled up. */
  const [unseen, setUnseen] = useState(false);
  const [previous, setPrevious] = useState(messages);

  // Adjusted while rendering, when the list changes (not in an effect).
  if (previous !== messages) {
    setPrevious(messages);
    // The reader's own message (and a restored conversation) goes to the
    // bottom; so does a fresh start after "New chat".
    const sentByReader = messages
      .slice(previous.length)
      .some((message) => message.role === "user");
    if (sentByReader || messages.length === 0) {
      setFollowing(true);
      setUnseen(false);
    } else if (!following) {
      setUnseen(true);
    }
  }

  const scrollIfFollowing = useEffectEvent(() => {
    // Scroll the list itself: scrollIntoView would also move the whole page.
    const list = scrollRef.current;
    if (list && following) scrollToBottom(list, false);
  });
  useEffect(() => scrollIfFollowing(), [messages]);

  useEffect(() => () => clearTimeout(jumpTimerRef.current), []);

  function onScroll() {
    const list = scrollRef.current;
    if (!list) return;
    const near =
      list.scrollHeight - list.scrollTop - list.clientHeight <=
      STICK_TO_BOTTOM_PX;
    // Mid-way through our own smooth scroll the list is not "scrolled up".
    if (jumpingRef.current) {
      if (!near) return;
      jumpingRef.current = false;
    }
    setFollowing(near);
    if (near) setUnseen(false);
  }

  function jumpToLatest() {
    const list = scrollRef.current;
    if (!list) return;
    const smooth = !prefersReducedMotion();
    setFollowing(true);
    jumpingRef.current = smooth;
    clearTimeout(jumpTimerRef.current);
    if (smooth) {
      jumpTimerRef.current = setTimeout(() => {
        jumpingRef.current = false;
      }, JUMP_SETTLE_MS);
    }
    setUnseen(false);
    scrollToBottom(list, smooth);
    // The button is about to disappear: keep keyboard focus in the conversation.
    list.focus({ preventScroll: true });
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        tabIndex={-1}
        onScroll={onScroll}
        className="h-full overflow-y-auto px-4 py-4 outline-none"
      >
        {messages.length === 0 ? empty : null}
        {/* Always mounted (empty at first) so screen readers register the live region before messages arrive. */}
        <ol
          aria-live="polite"
          aria-relevant="additions text"
          aria-busy={busy}
          aria-label="Conversation"
          className="flex flex-col gap-4"
        >
          {messages.map((message, index) => (
            <MessageItem
              key={message.id}
              message={message}
              stage={stage}
              canRetry={!busy && index === messages.length - 1}
              onRetry={onRetry}
              onOpenSearch={onOpenSearch}
            />
          ))}
        </ol>
      </div>
      {unseen ? (
        <Button
          variant="secondary"
          onClick={jumpToLatest}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-md"
        >
          <span aria-hidden="true">&darr;</span> Jump to latest
        </Button>
      ) : null}
    </div>
  );
}
