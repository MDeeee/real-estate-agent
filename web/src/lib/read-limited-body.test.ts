import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BodyTooLargeError, readLimitedBody } from "./read-limited-body.ts";

const LIMIT = 16 * 1024;

function post(body: BodyInit, headers: HeadersInit = {}): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    body,
    headers,
    // @ts-expect-error Node needs this for stream bodies.
    duplex: "half",
  });
}

/** A stream that reports how much of it was pulled. */
function countingStream(totalBytes: number, chunkBytes: number) {
  const state = { pulled: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.pulled >= totalBytes) {
        controller.close();
        return;
      }
      const size = Math.min(chunkBytes, totalBytes - state.pulled);
      state.pulled += size;
      controller.enqueue(new Uint8Array(size).fill(97));
    },
  });
  return { stream, state };
}

describe("readLimitedBody", () => {
  it("returns a small body", async () => {
    assert.equal(await readLimitedBody(post('{"message":"hi"}'), LIMIT), '{"message":"hi"}');
    assert.equal(await readLimitedBody(new Request("http://x/", { method: "POST" }), LIMIT), "");
  });

  it("refuses a declared Content-Length over the limit without reading", async () => {
    const { stream, state } = countingStream(LIMIT * 4, 1024);
    const request = post(stream, { "content-length": String(LIMIT + 1) });
    await assert.rejects(readLimitedBody(request, LIMIT), BodyTooLargeError);
    assert.equal(state.pulled <= 1024, true, "no more than the first pull");
  });

  it("stops reading a body that lies about (or hides) its length", async () => {
    const { stream, state } = countingStream(10 * 1024 * 1024, 4096);
    // Declares 10 bytes, sends megabytes.
    const lying = post(stream, { "content-length": "10" });
    await assert.rejects(readLimitedBody(lying, LIMIT), BodyTooLargeError);
    assert.ok(
      state.pulled < LIMIT * 4,
      `read ${state.pulled} bytes, expected to stop near ${LIMIT}`,
    );
  });

  it("counts bytes, not characters", async () => {
    const multibyte = "\u0639".repeat(LIMIT / 2 + 1); // 2 bytes each, over the limit
    await assert.rejects(readLimitedBody(post(multibyte), LIMIT), BodyTooLargeError);
    assert.equal((await readLimitedBody(post(multibyte.slice(1)), LIMIT)).length, LIMIT / 2);
  });
});
