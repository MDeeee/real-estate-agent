import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clientIpFromForwardedFor,
  parseTrustedProxyHops,
} from "./client-ip.ts";

describe("parseTrustedProxyHops", () => {
  it("defaults to 0 and treats anything invalid as 0", () => {
    assert.equal(parseTrustedProxyHops(undefined), 0);
    assert.equal(parseTrustedProxyHops(""), 0);
    assert.equal(parseTrustedProxyHops("-1"), 0);
    assert.equal(parseTrustedProxyHops("1.5"), 0);
    assert.equal(parseTrustedProxyHops("many"), 0);
    assert.equal(parseTrustedProxyHops("1"), 1);
    assert.equal(parseTrustedProxyHops(" 2 "), 2);
  });
});

describe("clientIpFromForwardedFor", () => {
  it("trusts nothing without trusted proxies, whatever the header says", () => {
    assert.equal(clientIpFromForwardedFor("1.2.3.4", 0), undefined);
    assert.equal(clientIpFromForwardedFor("1.2.3.4, 5.6.7.8", 0), undefined);
  });

  it("takes the entry our single proxy appended, not the forged left side", () => {
    // The visitor sent "1.2.3.4"; the proxy appended the real address.
    assert.equal(
      clientIpFromForwardedFor("1.2.3.4, 203.0.113.9", 1),
      "203.0.113.9",
    );
    assert.equal(clientIpFromForwardedFor("203.0.113.9", 1), "203.0.113.9");
  });

  it("skips the addresses of further trusted proxies on the right", () => {
    // visitor-forged, real visitor, first proxy (appended by the second).
    assert.equal(
      clientIpFromForwardedFor("9.9.9.9, 203.0.113.9, 10.0.0.2", 2),
      "203.0.113.9",
    );
  });

  it("a visitor cannot pick their bucket by adding entries on the left", () => {
    const real = "203.0.113.9";
    for (const forged of ["", "1.1.1.1, ", "1.1.1.1, 2.2.2.2, ", "::1, "]) {
      assert.equal(clientIpFromForwardedFor(`${forged}${real}`, 1), real);
    }
  });

  it("rejects a header shorter than the proxy chain and non-IP values", () => {
    assert.equal(clientIpFromForwardedFor("203.0.113.9", 2), undefined);
    assert.equal(clientIpFromForwardedFor("1.2.3.4, not-an-ip", 1), undefined);
    assert.equal(clientIpFromForwardedFor("1.2.3.4, ", 1), undefined);
    assert.equal(clientIpFromForwardedFor(null, 1), undefined);
    assert.equal(clientIpFromForwardedFor("2001:db8::1", 1), "2001:db8::1");
  });
});
