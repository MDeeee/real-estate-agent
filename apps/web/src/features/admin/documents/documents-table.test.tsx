import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentsTable } from "./documents-table";
import type { DocumentItem } from "./schemas";

const item = (id: string, filename: string): DocumentItem => ({
  id,
  filename,
  status: "INDEXED",
  error: null,
  property: { slug: id, title: id },
  chunkCount: 3,
  updatedAt: new Date("2026-10-01T10:00:00Z"),
});

function renderTable() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DocumentsTable
          data={{
            items: [item("a", "a.md"), item("b", "b.md")],
            total: 2,
            page: 1,
            pageSize: 20,
          }}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Deleting "a" is refused; re-indexing "b" works. */
function stubApi() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return Response.json(
          { message: "Cannot delete a.md: it has bookings." },
          { status: 409 },
        );
      }
      return Response.json({ filename: "b.md", outcome: "created", chunks: 3 });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DocumentsTable row feedback", () => {
  it("clears a row's error when an action starts on another row", async () => {
    stubApi();
    renderTable();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Delete a.md" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText(/cannot delete a\.md/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Re-index b.md" }));

    await waitFor(() => expect(screen.queryByText(/cannot delete a\.md/i)).toBeNull());
    expect(await screen.findByText("Re-indexed.")).toBeInTheDocument();
  });

  it("clears the error when the same row starts another action", async () => {
    stubApi();
    renderTable();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Delete a.md" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText(/cannot delete a\.md/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Re-index a.md" }));

    await waitFor(() => expect(screen.queryByText(/cannot delete a\.md/i)).toBeNull());
  });
});
