import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHAT_COOKIE,
  newThreadId,
  readThreadId,
  threadCookie,
} from "./chat-cookie.ts";

const ID = "3f2b8c1e-0a52-4d0e-9d1c-5b0e2f6a7c10";

describe("readThreadId", () => {
  it("reads a valid thread id among other cookies", () => {
    assert.equal(readThreadId(`a=b; ${CHAT_COOKIE}=${ID}; c=d`), ID);
  });

  it("treats a missing, malformed or forged value as no cookie", () => {
    assert.equal(readThreadId(null), undefined);
    assert.equal(readThreadId("a=b"), undefined);
    assert.equal(readThreadId(`${CHAT_COOKIE}=not-a-uuid`), undefined);
    assert.equal(readThreadId(`${CHAT_COOKIE}=${ID}extra`), undefined);
    assert.equal(readThreadId(`${CHAT_COOKIE}=`), undefined);
    assert.equal(readThreadId(`x${CHAT_COOKIE}=${ID}`), undefined);
  });
});

describe("threadCookie", () => {
  it("is httpOnly, lax, scoped to the chat routes and lasts 30 days", () => {
    const cookie = threadCookie(ID, false);
    assert.match(cookie, new RegExp(`^${CHAT_COOKIE}=${ID};`));
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Path=\/api\/chat(;|$)/);
    assert.match(cookie, /Max-Age=2592000/);
    assert.doesNotMatch(cookie, /Secure/);
  });

  it("adds Secure in production", () => {
    assert.match(threadCookie(ID, true), /; Secure$/);
  });
});

describe("newThreadId", () => {
  it("makes distinct ids that readThreadId accepts", () => {
    const a = newThreadId();
    assert.notEqual(a, newThreadId());
    assert.equal(readThreadId(`${CHAT_COOKIE}=${a}`), a);
  });
});
