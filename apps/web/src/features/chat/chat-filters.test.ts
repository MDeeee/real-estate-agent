import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  filterChips,
  filtersToHref,
  hasActiveFilters,
} from "./chat-filters";

describe("hasActiveFilters", () => {
  it("is false for an empty filter set, so the chat hides the open-in-search button", () => {
    assert.equal(hasActiveFilters({}), false);
    assert.equal(filterChips({}).length, 0);
  });

  it("ignores blank values", () => {
    assert.equal(hasActiveFilters({ city: "", type: "" }), false);
  });

  it("is true as soon as one filter is set, also one the regular form lacks", () => {
    assert.equal(hasActiveFilters({ city: "New Cairo" }), true);
    assert.equal(hasActiveFilters({ priceMax: 0 }), true);
    assert.equal(hasActiveFilters({ district: "Zamalek" }), true);
    assert.equal(hasActiveFilters({ bathroomsMin: 2 }), true);
  });
});

describe("filtersToHref", () => {
  it("links to the plain search for no filters and carries supported ones over", () => {
    assert.equal(filtersToHref({}), "/");
    assert.equal(
      filtersToHref({ city: "New Cairo", bedroomsMin: 3, district: "x" }),
      "/?city=New+Cairo&bedroomsMin=3",
    );
  });
});
