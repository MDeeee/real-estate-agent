import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { ChatMessage } from "./types";
import { applyEventToMessage } from "./chat-message-events";
import { settleStopped } from "./chat-stop";

const user: ChatMessage = { id: "u1", role: "user", text: "book the first one" };
const streaming: ChatMessage = {
  id: "a1",
  role: "assistant",
  text: "",
  streaming: true,
};
const booking = {
  id: "b1",
  reference: "ABCD1234",
  propertySlug: "a-b",
  propertyTitle: "A villa",
  name: "Sara",
  phone: "01012345678",
  preferredDate: "2026-10-20",
  preferredTime: "17:00",
  status: "CONFIRMED",
};
const CONFIRMATION = "Done! Your viewing is booked. Reference ABCD1234.";

describe("applyEventToMessage", () => {
  it("shows the confirmation text as soon as the booking event arrives", () => {
    const result = applyEventToMessage(streaming, {
      type: "booking",
      booking,
      text: CONFIRMATION,
    });
    assert.equal(result.text, CONFIRMATION);
    assert.equal(result.booking, booking);
    assert.equal(result.streaming, true);
  });

  it("keeps the confirmation after a Stop between booking and final, without a Stopped label", () => {
    const booked = applyEventToMessage(streaming, {
      type: "booking",
      booking,
      text: CONFIRMATION,
    });
    const settled = settleStopped([user, booked]);
    assert.equal(settled.length, 2);
    assert.equal(settled[1]?.text, CONFIRMATION);
    assert.equal(settled[1]?.stopped, undefined);
    assert.equal(settled[1]?.streaming, false);
  });

  it("the final event then replaces the text with the stored one", () => {
    const booked = applyEventToMessage(streaming, {
      type: "booking",
      booking,
      text: CONFIRMATION,
    });
    const final = applyEventToMessage(booked, {
      type: "final",
      text: CONFIRMATION,
      citedSlugs: [],
      intent: "book",
    });
    assert.equal(final.text, CONFIRMATION);
    assert.equal(final.streaming, false);
  });

  it("appends tokens, records errors, ignores status and done", () => {
    const withText = applyEventToMessage(
      applyEventToMessage(streaming, { type: "token", text: "Hel" }),
      { type: "token", text: "lo" },
    );
    assert.equal(withText.text, "Hello");
    assert.equal(
      applyEventToMessage(withText, { type: "error", message: "x" }).error,
      "x",
    );
    assert.equal(
      applyEventToMessage(withText, { type: "status", stage: "thinking" }),
      withText,
    );
    assert.equal(applyEventToMessage(withText, { type: "done" }), withText);
  });
});
