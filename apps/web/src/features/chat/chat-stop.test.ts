import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { ChatMessage } from "./types";
import { settleStopped } from "./chat-stop";

const user: ChatMessage = { id: "u1", role: "user", text: "villas in Zayed" };
const streaming = (extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: "a1",
  role: "assistant",
  text: "",
  streaming: true,
  ...extra,
});
const card = { slug: "a-b" } as NonNullable<ChatMessage["properties"]>[number];

describe("settleStopped", () => {
  it("removes a truly empty reply and marks the visitor's message instead", () => {
    const result = settleStopped([user, streaming()]);
    assert.deepEqual(result, [{ ...user, stopped: true }]);
  });

  it("keeps a reply with only a search summary, labelled Stopped (B5)", () => {
    const search = { filters: { city: "Zayed" }, semanticQuery: "" };
    const result = settleStopped([user, streaming({ search })]);
    assert.equal(result.length, 2);
    assert.deepEqual(result[1], { ...streaming({ search }), streaming: false, stopped: true });
    assert.equal(result[0]?.stopped, undefined);
  });

  it("keeps a reply with listings, labelled Stopped", () => {
    const result = settleStopped([user, streaming({ properties: [card] })]);
    assert.equal(result.length, 2);
    assert.equal(result[1]?.stopped, true);
    assert.equal(result[1]?.streaming, false);
  });

  it("keeps partial text, labelled Stopped", () => {
    const result = settleStopped([user, streaming({ text: "I found" })]);
    assert.equal(result[1]?.stopped, true);
    assert.equal(result[1]?.text, "I found");
  });

  it("never labels a reply that received a booking as Stopped (B4)", () => {
    const booking = { reference: "ABCD1234" } as NonNullable<ChatMessage["booking"]>;
    const result = settleStopped([user, streaming({ booking })]);
    assert.equal(result.length, 2);
    assert.equal(result[1]?.stopped, undefined);
    assert.equal(result[1]?.streaming, false);
    assert.equal(result[1]?.booking, booking);
  });

  it("leaves a finished reply alone", () => {
    const done: ChatMessage = { ...streaming({ text: "ok" }), streaming: false };
    const messages = [user, done];
    assert.equal(settleStopped(messages), messages);
  });
});
