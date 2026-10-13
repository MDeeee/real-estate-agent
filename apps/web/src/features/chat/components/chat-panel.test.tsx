import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "./chat-panel";

const encoder = new TextEncoder();

/**
 * A fake API: the history restores after `releaseHistory()` (at once by
 * default), and every chat reply stays open until `finishReply()`.
 */
function stubApi({ holdHistory = false } = {}) {
  let releaseHistory: () => void = () => {};
  const historyGate = new Promise<void>((resolve) => {
    releaseHistory = resolve;
  });
  let reply: ReadableStreamDefaultController<Uint8Array> | undefined;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/chat/history")) {
        if (holdHistory) await historyGate;
        return Response.json({ messages: [] });
      }
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          reply = controller;
          init?.signal?.addEventListener("abort", () =>
            controller.error(new DOMException("Aborted", "AbortError")),
          );
        },
      });
      return new Response(stream, {
        headers: { "content-type": "text/event-stream" },
      });
    }),
  );

  const send = (event: object) =>
    reply?.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  return {
    releaseHistory,
    finishReply() {
      send({ type: "final", text: "Done.", citedSlugs: [] });
      send({ type: "done" });
      reply?.close();
    },
  };
}

const textarea = () => screen.getByRole("textbox", { name: "Your message" });

/** A mouse (fine pointer) or a touch screen (coarse), as matchMedia reports it. */
function stubPointer(kind: "fine" | "coarse") {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: kind === "fine" && query === "(pointer: fine)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ChatPanel focus", () => {
  it("does not take focus while the history restores, or when it has restored", async () => {
    const api = stubApi({ holdHistory: true });
    render(<ChatPanel onOpenSearch={() => {}} />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(textarea()).not.toHaveFocus();

    api.releaseHistory();
    await screen.findByRole("list", { name: "Example questions" });

    expect(document.body).toHaveFocus();
  });

  it("returns focus to the textarea after Enter", async () => {
    stubApi();
    render(<ChatPanel onOpenSearch={() => {}} />);
    const user = userEvent.setup();

    await user.click(textarea());
    await user.keyboard("villas in Zayed{Enter}");

    expect(await screen.findByText("villas in Zayed")).toBeInTheDocument();
    expect(textarea()).toHaveFocus();
  });

  it("returns focus to the textarea after the Send button, which then becomes disabled", async () => {
    stubApi();
    render(<ChatPanel onOpenSearch={() => {}} />);
    const user = userEvent.setup();

    await user.type(textarea(), "a flat in Zamalek");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument(),
    );
    expect(textarea()).toHaveFocus();
  });

  it("returns focus to the textarea after a suggestion chip with a mouse", async () => {
    stubApi();
    stubPointer("fine");
    render(<ChatPanel onOpenSearch={() => {}} />);
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: /3 bedroom apartment in New Cairo/ }),
    );

    expect(await screen.findByRole("button", { name: "Stop" })).toBeInTheDocument();
    expect(textarea()).toHaveFocus();
  });

  it("does not open the keyboard after a suggestion chip on a touch screen", async () => {
    stubApi();
    stubPointer("coarse");
    render(<ChatPanel onOpenSearch={() => {}} />);
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: /3 bedroom apartment in New Cairo/ }),
    );

    expect(await screen.findByRole("button", { name: "Stop" })).toBeInTheDocument();
    expect(textarea()).not.toHaveFocus();
  });

  it("does not open the keyboard after Stop on a touch screen", async () => {
    stubApi();
    stubPointer("coarse");
    render(<ChatPanel onOpenSearch={() => {}} />);
    const user = userEvent.setup();

    await user.type(textarea(), "a flat in Zamalek{Enter}");
    await user.click(await screen.findByRole("button", { name: "Stop" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Stop" })).toBeNull());
    expect(textarea()).not.toHaveFocus();
  });

  it("keeps focus in the textarea after the composer's own send on a touch screen", async () => {
    stubApi();
    stubPointer("coarse");
    render(<ChatPanel onOpenSearch={() => {}} />);
    const user = userEvent.setup();

    await user.type(textarea(), "a flat in Zamalek");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await screen.findByRole("button", { name: "Stop" });
    expect(textarea()).toHaveFocus();
  });

  it("returns focus to the textarea after Stop with a mouse", async () => {
    stubApi();
    stubPointer("fine");
    render(<ChatPanel onOpenSearch={() => {}} />);
    const user = userEvent.setup();

    await user.type(textarea(), "a flat in Zamalek{Enter}");
    await user.click(await screen.findByRole("button", { name: "Stop" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Stop" })).toBeNull());
    expect(textarea()).toHaveFocus();
  });

  it("leaves focus where the visitor moved it while the reply streams", async () => {
    const api = stubApi();
    render(<ChatPanel onOpenSearch={() => {}} />);
    const user = userEvent.setup();

    await user.type(textarea(), "a flat in Zamalek{Enter}");
    await screen.findByRole("button", { name: "Stop" });
    const newChat = screen.getByRole("button", { name: "New chat" });
    newChat.focus();

    api.finishReply();

    await screen.findByText("Done.");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Stop" })).toBeNull());
    expect(newChat).toHaveFocus();
  });
});
