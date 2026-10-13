import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { ApiFetchInit, apiFetch } from "@/shared/api/http";
import { CONFLICT_BACKOFF_MS, postChat } from "./chat-request";

function harness(statuses: number[]) {
  const calls: unknown[] = [];
  const sleeps: number[] = [];
  const fetchImpl = (async (_path: string, init: ApiFetchInit) => {
    calls.push(init.json);
    const status = statuses[calls.length - 1] ?? 200;
    return new Response(status === 200 ? "ok" : "busy", { status });
  }) as unknown as typeof apiFetch;
  const sleep = async (ms: number) => {
    sleeps.push(ms);
  };
  return { calls, sleeps, options: { fetchImpl, sleep } };
}

describe("postChat", () => {
  it("sends only the message: the thread id is a server-side cookie", async () => {
    const { calls, options } = harness([200]);
    const response = await postChat("hello", new AbortController().signal, options);
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [{ message: "hello" }]);
  });

  it("retries a 409 with 400/800/1600 ms backoff, then succeeds", async () => {
    const { calls, sleeps, options } = harness([409, 409, 200]);
    const response = await postChat("hello", new AbortController().signal, options);
    assert.equal(response.status, 200);
    assert.equal(calls.length, 3);
    assert.deepEqual(sleeps, [400, 800]);
  });

  it("gives up after three retries and returns the 409", async () => {
    const { calls, sleeps, options } = harness([409, 409, 409, 409, 409]);
    const response = await postChat("hello", new AbortController().signal, options);
    assert.equal(response.status, 409);
    assert.equal(calls.length, 4);
    assert.deepEqual(sleeps, [...CONFLICT_BACKOFF_MS]);
  });

  it("does not retry other errors", async () => {
    const { calls, options } = harness([429]);
    const response = await postChat("hello", new AbortController().signal, options);
    assert.equal(response.status, 429);
    assert.equal(calls.length, 1);
  });

  it("stops waiting when the visitor aborts", async () => {
    const abort = new AbortController();
    const { options } = harness([409, 409]);
    const sleep = (_ms: number, signal: AbortSignal) =>
      new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason));
      });
    const pending = postChat("hello", abort.signal, { ...options, sleep });
    setTimeout(() => abort.abort(new Error("stopped")), 10);
    await assert.rejects(pending, /stopped/);
  });
});
