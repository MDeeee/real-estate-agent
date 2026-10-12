import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ResetGate } from "./chat-reset.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("ResetGate", () => {
  it("is ready at once when no reset is running", async () => {
    const gate = new ResetGate();
    assert.equal(gate.active, false);
    assert.equal(await gate.whenReady(), true);
  });

  it("queues a send behind a running reset and releases it when the reset succeeds", async () => {
    const gate = new ResetGate();
    const reset = deferred<boolean>();
    const order: string[] = [];

    const done = gate.begin(() => reset.promise);
    assert.equal(gate.active, true);
    const queued = gate.whenReady().then((ok) => {
      order.push(`send:${ok}`);
    });

    await Promise.resolve();
    assert.deepEqual(order, [], "the send must not start while the reset runs");

    reset.resolve(true);
    assert.equal(await done, true);
    await queued;
    assert.deepEqual(order, ["send:true"]);
    assert.equal(gate.active, false);
  });

  it("tells a queued send that the reset failed (rejected request or not ok)", async () => {
    const gate = new ResetGate();
    const reset = deferred<boolean>();
    const done = gate.begin(() => reset.promise);
    const queued = gate.whenReady();
    reset.reject(new Error("network"));
    assert.equal(await done, false);
    assert.equal(await queued, false);
    assert.equal(gate.active, false);

    assert.equal(await gate.begin(() => Promise.resolve(false)), false);
    assert.equal(await gate.whenReady(), true, "a finished reset no longer blocks");
  });

  it("a newer reset replaces the one being waited for", async () => {
    const gate = new ResetGate();
    const first = deferred<boolean>();
    const second = deferred<boolean>();
    void gate.begin(() => first.promise);
    void gate.begin(() => second.promise);
    let ready = false;
    const queued = gate.whenReady().then(() => {
      ready = true;
    });
    first.resolve(true);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(ready, false);
    assert.equal(gate.active, true);
    second.resolve(true);
    await queued;
    assert.equal(gate.active, false);
  });
});
