import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  hasActiveFilters,
  hrefFor,
  parseSearchParams,
  toSearchParams,
} from "./search-params";

const parse = (search: string) => parseSearchParams(new URLSearchParams(search));

describe("parseSearchParams", () => {
  it("defaults to the newest first page without filters", () => {
    assert.deepEqual(parse(""), { sort: "newest", page: 1 });
  });

  it("reads every supported filter", () => {
    assert.deepEqual(
      parse(
        "listing=RENT&city=New+Cairo&compound=Laurel&type=villa&priceMin=1000&priceMax=9000&bedroomsMin=3&areaMin=120&sort=price_asc&page=2",
      ),
      {
        listing: "RENT",
        city: "New Cairo",
        compound: "Laurel",
        type: "villa",
        priceMin: 1000,
        priceMax: 9000,
        bedroomsMin: 3,
        areaMin: 120,
        sort: "price_asc",
        page: 2,
      },
    );
  });

  it("drops values that are not valid instead of failing", () => {
    assert.deepEqual(
      parse("listing=LEASE&type=castle&priceMin=cheap&bedroomsMin=-2&sort=random&page=0&city=%20%20"),
      { sort: "newest", page: 1 },
    );
  });
});

describe("toSearchParams and hrefFor", () => {
  it("leaves out defaults, so the URL stays short", () => {
    assert.equal(hrefFor({ sort: "newest", page: 1 }), "/");
    assert.equal(
      hrefFor({ sort: "price_desc", page: 3, city: "Zamalek" }),
      "/?city=Zamalek&sort=price_desc&page=3",
    );
  });

  it("round-trips through the URL", () => {
    const query = parse("type=duplex&priceMax=5000000&sort=area_desc&page=4");
    assert.deepEqual(parse(toSearchParams(query).toString()), query);
  });

  it("applies overrides without touching the query", () => {
    const query = parse("city=Zamalek&page=2");
    assert.equal(hrefFor(query, { page: 1 }), "/?city=Zamalek");
    assert.equal(query.page, 2);
  });
});

describe("hasActiveFilters", () => {
  it("ignores sort and page", () => {
    assert.equal(hasActiveFilters(parse("sort=price_asc&page=2")), false);
    assert.equal(hasActiveFilters(parse("bedroomsMin=2")), true);
  });
});
