import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookingsTable } from "./bookings-table";
import { useBookings } from "./bookings-api";
import type { BookingItem } from "./schemas";

const booking = (id: string, status: BookingItem["status"]): BookingItem => ({
  id,
  reference: id.toUpperCase().padEnd(8, "X"),
  name: `Visitor ${id}`,
  phone: "+20 100 000 0000",
  preferredDate: "2026-12-01",
  preferredTime: "17:00",
  status,
  createdAt: new Date("2026-10-01T10:00:00Z"),
  property: { slug: `flat-${id}`, title: `Flat ${id}` },
});

const wire = (item: BookingItem) => ({
  ...item,
  createdAt: item.createdAt.toISOString(),
});

/** The server's state: a mutable list, so a refetch after a cancel sees it. */
function stubApi(options: { cancelFails?: boolean } = {}) {
  const items = [booking("aaa", "CONFIRMED"), booking("bbb", "CANCELLED")];
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      if (options.cancelFails) {
        return Response.json({ message: "Booking not found." }, { status: 404 });
      }
      items[0] = { ...items[0]!, status: "CANCELLED" };
      return Response.json(wire(items[0]));
    }
    return Response.json({
      items: items.map(wire),
      total: items.length,
      page: 1,
      pageSize: 20,
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function Table() {
  const { data } = useBookings(1);
  return data ? <BookingsTable data={data} /> : <p>Loading</p>;
}

function renderTable() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Table />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BookingsTable cancel flow", () => {
  it("offers Cancel on an active booking only", async () => {
    stubApi();
    renderTable();

    expect(
      await screen.findByRole("button", { name: "Cancel booking AAAXXXXX" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Cancel booking/ })).toHaveLength(1);
    expect(screen.getByText("CANCELLED")).toBeInTheDocument();
  });

  it("confirms in a dialog that shows the booking, then marks the row cancelled", async () => {
    const fetchMock = stubApi();
    renderTable();
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "Cancel booking AAAXXXXX" }),
    );

    const dialog = screen.getByRole("dialog", { name: "Cancel this booking?" });
    expect(within(dialog).getByText("AAAXXXXX")).toBeInTheDocument();
    expect(within(dialog).getByText("Flat aaa")).toBeInTheDocument();
    expect(within(dialog).getByText("1 Dec 2026")).toBeInTheDocument();
    expect(within(dialog).getByText("17:00")).toBeInTheDocument();
    expect(within(dialog).getByText("Visitor aaa")).toBeInTheDocument();
    // Nothing is sent before the admin confirms.
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);

    await user.click(within(dialog).getByRole("button", { name: "Cancel booking" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(screen.getAllByText("CANCELLED")).toHaveLength(2));
    expect(screen.queryByRole("button", { name: /^Cancel booking/ })).toBeNull();
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(post?.[0]).toBe("/api/admin/bookings/aaa/cancel");
  });

  it("keeps the booking when the admin chooses Keep", async () => {
    const fetchMock = stubApi();
    renderTable();
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "Cancel booking AAAXXXXX" }),
    );
    await user.click(screen.getByRole("button", { name: "Keep" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    expect(screen.getByRole("button", { name: "Cancel booking AAAXXXXX" })).toBeInTheDocument();
  });

  it("shows a failure inline on its row and keeps the Cancel button", async () => {
    stubApi({ cancelFails: true });
    renderTable();
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "Cancel booking AAAXXXXX" }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel booking" }),
    );

    const row = (await screen.findByText("Visitor aaa")).closest("tr")!;
    expect(await within(row).findByRole("alert")).toHaveTextContent(/not found/i);
    expect(within(row).getByRole("button", { name: "Cancel booking AAAXXXXX" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("BookingsTable on a narrow screen", () => {
  /** matchMedia for a phone: the `sm` (min-width) query does not match. */
  function stubPhone() {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
  }

  it("stacks each booking as a card with its details and a Cancel button in view", async () => {
    stubApi();
    stubPhone();
    renderTable();

    const list = await screen.findByRole("list", { name: "Property viewing bookings" });
    expect(screen.queryByRole("table")).toBeNull();
    const [active, cancelled] = within(list).getAllByRole("listitem");
    expect(within(active!).getByText("Visitor aaa")).toBeInTheDocument();
    expect(within(active!).getByText("AAAXXXXX")).toBeInTheDocument();
    expect(within(active!).getByText("Flat aaa")).toBeInTheDocument();
    expect(within(active!).getByText("+20 100 000 0000")).toBeInTheDocument();
    expect(within(active!).getByText("CONFIRMED")).toBeInTheDocument();
    expect(
      within(active!).getByRole("button", { name: "Cancel booking AAAXXXXX" }),
    ).toBeInTheDocument();
    expect(within(cancelled!).getByText("CANCELLED")).toBeInTheDocument();
    expect(within(cancelled!).queryByRole("button")).toBeNull();
  });

  it("cancels from a card through the same confirmation", async () => {
    const fetchMock = stubApi();
    stubPhone();
    renderTable();
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "Cancel booking AAAXXXXX" }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel booking" }),
    );

    await waitFor(() => expect(screen.getAllByText("CANCELLED")).toHaveLength(2));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(post?.[0]).toBe("/api/admin/bookings/aaa/cancel");
  });
});
