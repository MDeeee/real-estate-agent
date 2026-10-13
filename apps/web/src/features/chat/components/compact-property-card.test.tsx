import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ChatCard } from "../api/chat-schemas";
import { CompactPropertyCard } from "./compact-property-card";

const card = (overrides: Partial<ChatCard> = {}): ChatCard => ({
  id: "p1",
  slug: "flat",
  title: "Garden flat in New Cairo",
  type: "apartment",
  listing: "SALE",
  price: 6_500_000,
  currency: "EGP",
  bedrooms: 3,
  bathrooms: 2,
  areaM2: 160,
  city: "Cairo",
  district: "New Cairo",
  compound: null,
  finishing: "fully finished",
  deliveryDate: "2099-06-30",
  paymentPlan: "10% down payment, 8 years instalments",
  excerpt: "",
  ...overrides,
});

describe("CompactPropertyCard facts", () => {
  it("shows delivery, finishing and a short payment plan", () => {
    render(<CompactPropertyCard property={card()} />);

    expect(screen.getByText("Delivery 2099")).toBeInTheDocument();
    expect(screen.getByText("Fully finished")).toBeInTheDocument();
    expect(screen.getByText("10% down · 8 yrs")).toBeInTheDocument();
  });

  it("says Ready when the delivery date has passed", () => {
    render(<CompactPropertyCard property={card({ deliveryDate: "2020-01-31" })} />);
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });

  it("hides a missing field cleanly", () => {
    const { container } = render(
      <CompactPropertyCard
        property={card({ finishing: null, deliveryDate: null, paymentPlan: null })}
      />,
    );

    expect(screen.queryByText(/delivery|finished|down/i)).toBeNull();
    expect(container.querySelector("ul")).toBeNull();
  });

  it("keeps the other facts when only one is missing", () => {
    render(<CompactPropertyCard property={card({ finishing: null })} />);
    expect(screen.getByText("Delivery 2099")).toBeInTheDocument();
    expect(screen.queryByText("Fully finished")).toBeNull();
  });

  it("shows an Arabic payment plan as written, with automatic direction", () => {
    const plan = "مقدم 10% وتقسيط على 8 سنوات";
    render(<CompactPropertyCard property={card({ paymentPlan: plan })} />);

    const line = screen.getByText(plan);
    expect(line).toHaveAttribute("dir", "auto");
    expect(line).toHaveAttribute("title", plan);
  });

  it("clamps a very long payment plan instead of overflowing", () => {
    render(
      <CompactPropertyCard property={card({ paymentPlan: "Flexible terms ".repeat(40) })} />,
    );
    const line = screen.getByTitle(/Flexible terms/);
    expect(line).toHaveClass("line-clamp-2", "break-words");
  });
});
