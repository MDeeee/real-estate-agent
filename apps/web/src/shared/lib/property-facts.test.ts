import { describe, expect, it } from "vitest";
import {
  formatDelivery,
  formatFinishing,
  formatPaymentPlan,
} from "./property-facts";

const NOW = new Date("2026-10-13T12:00:00Z");

describe("formatDelivery", () => {
  it("says Ready for a date that has passed", () => {
    expect(formatDelivery("2026-01-31", NOW)).toBe("Ready");
    expect(formatDelivery(new Date("2025-06-30T00:00:00Z"), NOW)).toBe("Ready");
  });

  it("names the year of a future delivery, from a string or a Date", () => {
    expect(formatDelivery("2027-06-30", NOW)).toBe("Delivery 2027");
    expect(formatDelivery(new Date("2028-03-31T00:00:00Z"), NOW)).toBe("Delivery 2028");
  });

  it("does not shift a 31 December into the next year", () => {
    expect(formatDelivery("2027-12-31", NOW)).toBe("Delivery 2027");
  });

  it("shows nothing for a missing or unreadable date", () => {
    expect(formatDelivery(null, NOW)).toBeNull();
    expect(formatDelivery(undefined, NOW)).toBeNull();
    expect(formatDelivery("soon", NOW)).toBeNull();
  });
});

describe("formatFinishing", () => {
  it("capitalises the first letter", () => {
    expect(formatFinishing("fully finished")).toBe("Fully finished");
    expect(formatFinishing("  core and shell ")).toBe("Core and shell");
  });

  it("shows nothing when blank", () => {
    expect(formatFinishing(null)).toBeNull();
    expect(formatFinishing("   ")).toBeNull();
  });
});

describe("formatPaymentPlan", () => {
  it("compacts the common English plan", () => {
    expect(formatPaymentPlan("10% down payment, 8 years instalments")).toBe("10% down · 8 yrs");
    expect(formatPaymentPlan("15% down payment, balance over 6 years with no interest")).toBe(
      "15% down · 6 yrs",
    );
  });

  it("takes the years of the instalments, not of the delivery", () => {
    expect(formatPaymentPlan("Delivery in 2 years, 10% down, 8 years installments")).toBe(
      "10% down · 8 yrs",
    );
    expect(formatPaymentPlan("10% down, balance over 7 years, delivery in 3 years")).toBe(
      "10% down · 7 yrs",
    );
  });

  it("shows the raw text when the years cannot be tied to the instalments", () => {
    const plan = "Delivery in 2 years, 10% down, pay the rest later";
    expect(formatPaymentPlan(plan)).toBe(plan);
    const two = "10% down, 5 years instalments or 8 years instalments";
    expect(formatPaymentPlan(two)).toBe(two);
  });

  it("keeps any other text as written", () => {
    expect(formatPaymentPlan("Monthly rent, two months deposit")).toBe(
      "Monthly rent, two months deposit",
    );
    expect(formatPaymentPlan("مقدم 10% وتقسيط على 8 سنوات")).toBe("مقدم 10% وتقسيط على 8 سنوات");
  });

  it("shows nothing when blank", () => {
    expect(formatPaymentPlan(undefined)).toBeNull();
    expect(formatPaymentPlan("")).toBeNull();
  });
});
