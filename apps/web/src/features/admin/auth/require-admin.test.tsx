import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "./login-page";
import { RequireAdmin } from "./require-admin";
import { adminSessionKey } from "./session-api";

function renderAt(path: string, session?: { authenticated: boolean; expired?: boolean }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (session) client.setQueryData(adminSessionKey, session);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/login" element={<LoginPage />} />
          <Route element={<RequireAdmin />}>
            <Route path="/admin" element={<p>Dashboard</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function stubSession(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(body, { status })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RequireAdmin", () => {
  it("shows the admin page to a signed-in visitor", async () => {
    stubSession({ authenticated: true });
    renderAt("/admin");

    expect(await screen.findByText("Dashboard")).toBeInTheDocument();
  });

  it("sends a visitor without a session to the login page", async () => {
    stubSession({ authenticated: false });
    renderAt("/admin");

    expect(await screen.findByLabelText("Admin token")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard")).toBeNull();
    expect(screen.queryByText(/no longer valid/i)).toBeNull();
  });

  it("says so on the login page when the API just refused the session", async () => {
    stubSession({ authenticated: false });
    renderAt("/admin", { authenticated: false, expired: true });

    expect(await screen.findByText(/no longer valid/i)).toBeInTheDocument();
  });

  it("offers a retry when the session cannot be checked", async () => {
    stubSession({ message: "down" }, 503);
    renderAt("/admin");

    expect(await screen.findByText(/could not check your session/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});
