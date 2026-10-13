import { describe, expect, it } from "vitest";
import { errorFor } from "./use-chat";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers });

describe("errorFor", () => {
  it("blames the length only when the message was too long", async () => {
    expect(await errorFor(json(400, { message: "x" }), "a".repeat(1001))).toMatch(
      /limited to 1,000 characters/,
    );
    expect(await errorFor(json(400, { message: "x" }), "short")).toMatch(
      /could not be sent/,
    );
  });

  it("explains 409 and 413", async () => {
    expect(await errorFor(json(409, {}), "hi")).toMatch(/still being written/);
    expect(await errorFor(json(413, {}), "hi")).toBe("That message is too large to send.");
  });

  it("shows how long to wait after a 429, rounded up", async () => {
    const response = json(429, { message: "Too many requests." }, { "retry-after": "17.2" });
    expect(await errorFor(response, "hi")).toBe(
      "You are sending messages too quickly. Please wait 18 seconds and try again.",
    );
  });

  it("passes the API's busy message through, whatever Retry-After says", async () => {
    const busy = "The assistant is busy, please try again in a minute.";
    expect(await errorFor(json(429, { message: busy }, { "retry-after": "20" }), "hi")).toBe(busy);
  });

  it("does not show an absurd wait: falls back to the API message, or to a generic one", async () => {
    const long = { "retry-after": "7200" };
    expect(await errorFor(json(429, { message: "Try later." }, long), "hi")).toBe("Try later.");
    expect(await errorFor(new Response("<html/>", { status: 429, headers: long }), "hi")).toBe(
      "You are sending messages too quickly. Please wait a minute and try again.",
    );
  });

  it("uses the API's message for 503, or a default when the body is unreadable", async () => {
    expect(await errorFor(json(503, { message: "No LLM configured." }), "hi")).toBe(
      "No LLM configured.",
    );
    expect(await errorFor(new Response("<html/>", { status: 503 }), "hi")).toBe(
      "The AI assistant is not available right now.",
    );
  });

  it("is generic for anything else", async () => {
    expect(await errorFor(json(500, { message: "boom" }), "hi")).toBe(
      "Something went wrong. Please try again.",
    );
  });
});
