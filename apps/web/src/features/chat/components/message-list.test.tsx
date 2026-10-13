import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../types";
import { MessageList } from "./message-list";

const user = (id: string, text: string): ChatMessage => ({ id, role: "user", text });
const reply = (id: string, text: string): ChatMessage => ({
  id,
  role: "assistant",
  text,
});

/** jsdom does no layout: give the scroll container a size and a settable scroll position. */
function sizeList(list: HTMLElement, size: { scrollHeight: number }) {
  let top = 0;
  Object.defineProperty(list, "scrollHeight", {
    get: () => size.scrollHeight,
    configurable: true,
  });
  Object.defineProperty(list, "clientHeight", {
    get: () => 400,
    configurable: true,
  });
  Object.defineProperty(list, "scrollTop", {
    get: () => top,
    set: (value: number) => {
      top = value;
    },
    configurable: true,
  });
  list.scrollTo = ((options: ScrollToOptions) => {
    top = options.top ?? 0;
  }) as typeof list.scrollTo;
}

function setup(messages: ChatMessage[]) {
  const props = {
    stage: null,
    busy: false,
    empty: null,
    onRetry: () => {},
    onOpenSearch: () => {},
  };
  const view = render(<MessageList messages={messages} {...props} />);
  const list = screen.getByLabelText("Conversation").parentElement!;
  const size = { scrollHeight: 1000 };
  sizeList(list, size);
  return {
    list,
    size,
    update: (next: ChatMessage[]) =>
      view.rerender(<MessageList messages={next} {...props} />),
  };
}

function scrollTo(list: HTMLElement, top: number) {
  list.scrollTop = top;
  fireEvent.scroll(list);
}

const jumpButton = () => screen.queryByRole("button", { name: /jump to latest/i });
const history = [user("1", "hello"), reply("2", "hi")];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MessageList auto-scroll", () => {
  it("follows new content while the reader is near the bottom", () => {
    const { list, size, update } = setup(history);
    scrollTo(list, 540); // 1000 - 540 - 400 = 60px from the bottom

    size.scrollHeight = 1300;
    update([history[0]!, reply("2", "hi there, a longer answer")]);

    expect(list.scrollTop).toBe(1300);
    expect(jumpButton()).toBeNull();
  });

  it("leaves a reader who scrolled up where they are and offers a jump", () => {
    const { list, size, update } = setup(history);
    scrollTo(list, 100);

    size.scrollHeight = 1300;
    update([history[0]!, reply("2", "hi there, a longer answer")]);

    expect(list.scrollTop).toBe(100);
    expect(jumpButton()).toBeInTheDocument();
  });

  it("does not show the button before anything new arrives", () => {
    const { list } = setup(history);
    scrollTo(list, 100);
    expect(jumpButton()).toBeNull();
  });

  it("jumps to the bottom from the keyboard and hides the button", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const { list, size, update } = setup(history);
    scrollTo(list, 100);
    size.scrollHeight = 1300;
    update([history[0]!, reply("2", "more")]);

    jumpButton()!.focus();
    await userEvent.setup().keyboard("{Enter}");

    expect(list.scrollTop).toBe(1300);
    expect(jumpButton()).toBeNull();
  });

  it("jumps without animation when the reader prefers reduced motion", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("reduce"),
    }));
    const { list, size, update } = setup(history);
    const scrollToSpy = vi.spyOn(list, "scrollTo");
    scrollTo(list, 100);
    size.scrollHeight = 1300;
    update([history[0]!, reply("2", "more")]);

    await userEvent.setup().click(jumpButton()!);

    expect(scrollToSpy).toHaveBeenCalledWith({ top: 1300, behavior: "auto" });
  });

  it("scrolls smoothly otherwise", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const { list, size, update } = setup(history);
    const scrollToSpy = vi.spyOn(list, "scrollTo");
    scrollTo(list, 100);
    size.scrollHeight = 1300;
    update([history[0]!, reply("2", "more")]);

    await userEvent.setup().click(jumpButton()!);

    expect(scrollToSpy).toHaveBeenCalledWith({ top: 1300, behavior: "smooth" });
  });

  it("goes to the bottom when the reader sends a message, even from further up", () => {
    const { list, size, update } = setup(history);
    scrollTo(list, 100);

    size.scrollHeight = 1500;
    act(() => {
      update([...history, user("3", "another question"), reply("4", "")]);
    });

    expect(list.scrollTop).toBe(1500);
    expect(jumpButton()).toBeNull();
  });

  it("hides the button by itself once the reader scrolls back down", () => {
    const { list, size, update } = setup(history);
    scrollTo(list, 100);
    size.scrollHeight = 1300;
    update([history[0]!, reply("2", "more")]);
    expect(jumpButton()).toBeInTheDocument();

    scrollTo(list, 850); // 1300 - 850 - 400 = 50px from the bottom

    expect(jumpButton()).toBeNull();
  });
});
