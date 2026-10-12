import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  cardDomId,
  citedSlugsIn,
  segmentCitations,
  splitCards,
  type TextSegment,
} from "./chat-citations.ts";

const known = new Set(["laurel-villa", "zamalek-flat"]);

// The API parses the same grammar (api/src/agent/citations.ts) and replays the
// same cases: contracts/citations.json is the shared contract.
interface CitationCase {
  name: string;
  text: string;
  known: string[];
  streaming?: boolean;
  slugs?: string[];
  sanitised?: { text: string; cited: string[]; dropped: string[] };
  segments: TextSegment[];
}
const contract = JSON.parse(
  readFileSync(
    new URL("../../../contracts/citations.json", import.meta.url),
    "utf8",
  ),
) as { cases: CitationCase[] };

describe("citedSlugsIn", () => {
  it("lists distinct slugs in order of first appearance", () => {
    assert.deepEqual(
      citedSlugsIn("A [zamalek-flat], B [laurel-villa], again [zamalek-flat]."),
      ["zamalek-flat", "laurel-villa"],
    );
  });

  it("ignores markdown links, plain words in brackets and no brackets", () => {
    assert.deepEqual(citedSlugsIn("see [docs](https://example.com)"), []);
    assert.deepEqual(citedSlugsIn("[1] [123] [Hello World]"), []);
    assert.deepEqual(citedSlugsIn("nothing here"), []);
  });
});

describe("segmentCitations", () => {
  it("turns a known citation into a segment between its text", () => {
    assert.deepEqual(
      segmentCitations("A villa [laurel-villa] for rent.", known),
      [
        { kind: "text", text: "A villa " },
        { kind: "citation", slug: "laurel-villa" },
        { kind: "text", text: " for rent." },
      ],
    );
  });

  it("drops an unknown slug together with the blank before it, never rendering it raw", () => {
    assert.deepEqual(
      segmentCitations("Two [zamalek-flat] and one [ghost-listing] more.", known),
      [
        { kind: "text", text: "Two " },
        { kind: "citation", slug: "zamalek-flat" },
        { kind: "text", text: " and one more." },
      ],
    );
  });

  it("leaves markdown links and ordinary brackets as text", () => {
    assert.deepEqual(segmentCitations("[docs](https://x.test) [A B]", known), [
      { kind: "text", text: "[docs](https://x.test) [A B]" },
    ]);
  });

  it("keeps two citations in a row", () => {
    assert.deepEqual(
      segmentCitations("[laurel-villa][zamalek-flat]", known),
      [
        { kind: "citation", slug: "laurel-villa" },
        { kind: "citation", slug: "zamalek-flat" },
      ],
    );
  });

  it("keeps Arabic text around a citation", () => {
    assert.deepEqual(segmentCitations("فيلا [laurel-villa] للإيجار", known), [
      { kind: "text", text: "فيلا " },
      { kind: "citation", slug: "laurel-villa" },
      { kind: "text", text: " للإيجار" },
    ]);
  });

  describe("while streaming", () => {
    for (const partial of ["[", "[lau", "[laurel-vil", "[laurel-villa"]) {
      it(`hides the unfinished citation ${JSON.stringify(partial)} at the end`, () => {
        assert.deepEqual(
          segmentCitations(`Try this one ${partial}`, known, { streaming: true }),
          [{ kind: "text", text: "Try this one " }],
        );
      });
    }

    it("shows the citation as soon as it closes", () => {
      assert.deepEqual(
        segmentCitations("Try [laurel-villa]", known, { streaming: true }),
        [
          { kind: "text", text: "Try " },
          { kind: "citation", slug: "laurel-villa" },
        ],
      );
    });

    it("does not hide brackets that cannot be a citation", () => {
      assert.deepEqual(
        segmentCitations("Price [EGP", known, { streaming: true }),
        [{ kind: "text", text: "Price [EGP" }],
      );
    });

    it("does not hide an unfinished bracket once the stream is done", () => {
      assert.deepEqual(segmentCitations("Try [lau", known), [
        { kind: "text", text: "Try [lau" },
      ]);
    });
  });
});

describe("splitCards", () => {
  const cards = ["a", "b", "c", "d"].map((slug) => ({ slug }));

  it("puts the cited cards first in citation order and keeps the rest in retrieval order", () => {
    const { cited, other } = splitCards(cards, ["c", "a"]);
    assert.deepEqual(
      cited.map((card) => card.slug),
      ["c", "a"],
    );
    assert.deepEqual(
      other.map((card) => card.slug),
      ["b", "d"],
    );
  });

  it("ignores citations without a card and repeated citations", () => {
    const { cited, other } = splitCards(cards, ["zzz", "b", "b"]);
    assert.deepEqual(
      cited.map((card) => card.slug),
      ["b"],
    );
    assert.equal(other.length, 3);
  });

  it("leaves everything in the other group when nothing was cited", () => {
    const { cited, other } = splitCards(cards, []);
    assert.equal(cited.length, 0);
    assert.equal(other.length, 4);
  });
});

describe("cardDomId", () => {
  it("is unique per message and slug", () => {
    assert.notEqual(cardDomId("m1", "a-b"), cardDomId("m2", "a-b"));
    assert.equal(cardDomId("m1", "a-b"), "card-m1-a-b");
  });
});

describe("shared citation contract (contracts/citations.json)", () => {
  it("has cases to replay", () => {
    assert.ok(contract.cases.length > 5);
  });

  for (const example of contract.cases) {
    describe(example.name, () => {
      if (example.slugs) {
        it("finds the cited slugs", () => {
          assert.deepEqual(citedSlugsIn(example.text), example.slugs);
        });
      }

      it("splits into the expected segments", () => {
        assert.deepEqual(
          segmentCitations(example.text, new Set(example.known), {
            streaming: example.streaming ?? false,
          }),
          example.segments,
        );
      });

      if (example.sanitised) {
        it("shows exactly the text the API keeps", () => {
          const shown = segmentCitations(example.text, new Set(example.known))
            .map((s) => (s.kind === "text" ? s.text : `[${s.slug}]`))
            .join("")
            .trim();
          assert.equal(shown, example.sanitised?.text);
        });
      }
    });
  }
});
