import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  API_UNREACHABLE_MESSAGE,
  ApiError,
  apiFetch,
  describeError,
  request,
  requestVoid,
  toApiError,
} from "./http";

function stubFetch(outcome: Response | { rejectWith: unknown }) {
  const fetchMock = vi.fn<typeof fetch>(async () => {
    if (!(outcome instanceof Response)) throw outcome.rejectWith;
    return outcome;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function lastCall(fetchMock: ReturnType<typeof stubFetch>) {
  const [url, init] = fetchMock.mock.calls.at(-1) ?? [];
  return { url, init, headers: new Headers(init?.headers) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiFetch", () => {
  it("calls the API on the same origin with the CSRF header on every request", async () => {
    const fetchMock = stubFetch(Response.json({}));

    await apiFetch("/chat/history");

    const { url, headers } = lastCall(fetchMock);
    expect(url).toBe("/api/chat/history");
    expect(headers.get("x-requested-with")).toBe("fetch");
  });

  it("sends a json option as a JSON body", async () => {
    const fetchMock = stubFetch(new Response(null, { status: 204 }));

    await apiFetch("/admin/session", { method: "POST", json: { token: "t" } });

    const { init, headers } = lastCall(fetchMock);
    expect(init?.body).toBe(JSON.stringify({ token: "t" }));
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("leaves the content type of a multipart body to the browser", async () => {
    const fetchMock = stubFetch(Response.json([]));
    const form = new FormData();
    form.append("files", new Blob(["x"]), "a.md");

    await apiFetch("/admin/documents", { method: "POST", body: form });

    const { init, headers } = lastCall(fetchMock);
    expect(init?.body).toBe(form);
    expect(headers.has("content-type")).toBe(false);
  });

  it("turns a network failure into an unreachable error", async () => {
    stubFetch({ rejectWith: new TypeError("Failed to fetch") });

    await expect(apiFetch("/properties")).rejects.toMatchObject({
      status: 503,
      message: API_UNREACHABLE_MESSAGE,
    });
  });

  it("lets an abort through untouched", async () => {
    const controller = new AbortController();
    controller.abort();
    const abort = new DOMException("Aborted", "AbortError");
    stubFetch({ rejectWith: abort });

    await expect(
      apiFetch("/chat", { signal: controller.signal }),
    ).rejects.toBe(abort);
  });
});

describe("request", () => {
  it("returns the parsed JSON", async () => {
    stubFetch(Response.json({ total: 3 }));

    await expect(
      request("/properties", z.object({ total: z.number() })),
    ).resolves.toEqual({ total: 3 });
  });

  it("reports a body that does not match the schema as a 502", async () => {
    stubFetch(Response.json({ total: "many" }));

    await expect(
      request("/properties", z.object({ total: z.number() })),
    ).rejects.toMatchObject({ status: 502 });
  });

  it("carries the API's message and validation issues", async () => {
    stubFetch(
      Response.json(
        {
          message: "Invalid query",
          issues: [{ path: "priceMin", message: "must not be greater than priceMax" }],
        },
        { status: 400 },
      ),
    );

    const error = await request("/properties", z.unknown()).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      message: "Invalid query",
      issues: [{ path: "priceMin", message: "must not be greater than priceMax" }],
    });
  });

  it("joins a message that is a list", async () => {
    stubFetch(Response.json({ message: ["a", "b"] }, { status: 400 }));

    await expect(request("/x", z.unknown())).rejects.toMatchObject({
      message: "a\nb",
    });
  });

  it("falls back to the status when the body is not the API's", async () => {
    stubFetch(new Response("<html>bad gateway</html>", { status: 502 }));

    await expect(request("/x", z.unknown())).rejects.toMatchObject({
      status: 502,
      message: "The API responded with status 502.",
    });
  });

  it("keeps Retry-After of a 429", async () => {
    stubFetch(
      Response.json(
        { message: "Too many requests. Please wait a moment and try again." },
        { status: 429, headers: { "retry-after": "17" } },
      ),
    );

    await expect(request("/x", z.unknown())).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 17,
    });
  });
});

describe("toApiError", () => {
  it("ignores a Retry-After longer than an hour", async () => {
    const error = await toApiError(
      Response.json({ message: "Wait" }, { status: 429, headers: { "retry-after": "3601" } }),
    );
    expect(error.retryAfterSeconds).toBeUndefined();

    const hour = await toApiError(
      new Response(null, { status: 429, headers: { "retry-after": "3600" } }),
    );
    expect(hour.retryAfterSeconds).toBe(3600);
  });

  it("tells the API's own message from the status fallback", async () => {
    expect((await toApiError(Response.json({ message: "Busy" }, { status: 503 }))).hasServerMessage).toBe(true);
    expect((await toApiError(new Response("<html/>", { status: 503 }))).hasServerMessage).toBe(false);
  });
});

describe("requestVoid", () => {
  it("resolves for 204 and rejects for an error status", async () => {
    stubFetch(new Response(null, { status: 204 }));
    await expect(requestVoid("/admin/session", { method: "DELETE" })).resolves.toBeUndefined();

    stubFetch(Response.json({ message: "Nope" }, { status: 401 }));
    await expect(requestVoid("/admin/session", { method: "DELETE" })).rejects.toMatchObject({
      status: 401,
      message: "Nope",
    });
  });
});

describe("describeError", () => {
  it("says how long to wait after a 429", () => {
    expect(describeError(new ApiError(429, "slow down", [], 17.2))).toBe(
      "Too many requests. Please wait 18 seconds and try again.",
    );
  });

  it("uses the API's message otherwise, and a generic one for unknown errors", () => {
    expect(describeError(new ApiError(429, "Try later"))).toBe("Try later");
    expect(describeError(new ApiError(409, "Already running"))).toBe("Already running");
    expect(describeError(new Error("boom"))).toBe(
      "Something went wrong. Please try again.",
    );
  });
});
