import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { formatBookingDate, formatBookingWhen } from "./booking-when";

describe("formatBookingDate", () => {
  it("formats a calendar date as written, without any time zone shift", () => {
    assert.equal(formatBookingDate("2026-10-19"), "19 Oct 2026");
    assert.equal(formatBookingDate("2026-01-01"), "1 Jan 2026");
    assert.equal(formatBookingDate("2026-12-31"), "31 Dec 2026");
  });

  it("reads an ISO timestamp as its UTC day (a DATE column serialised as midnight UTC)", () => {
    assert.equal(formatBookingDate("2026-10-19T00:00:00.000Z"), "19 Oct 2026");
    assert.equal(formatBookingDate("2026-10-19T23:59:59.000Z"), "19 Oct 2026");
  });

  it("returns an unreadable value untouched", () => {
    assert.equal(formatBookingDate("someday"), "someday");
  });
});

describe("formatBookingWhen", () => {
  it("appends the time of day when there is one", () => {
    assert.equal(formatBookingWhen("2026-10-19", "17:00"), "19 Oct 2026, 17:00");
    assert.equal(formatBookingWhen("2026-10-19", "09:30"), "19 Oct 2026, 09:30");
  });

  it("says any time when the visitor had no preference", () => {
    assert.equal(formatBookingWhen("2026-10-19", null), "19 Oct 2026 · any time");
    assert.equal(
      formatBookingWhen("2026-10-19", undefined),
      "19 Oct 2026 · any time",
    );
    assert.equal(formatBookingWhen("2026-10-19", " "), "19 Oct 2026 · any time");
  });

  it("does not show a midnight time for a date-only value", () => {
    assert.equal(
      formatBookingWhen("2026-10-19T00:00:00.000Z", "17:00"),
      "19 Oct 2026, 17:00",
    );
  });
});
