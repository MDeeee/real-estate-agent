// The API sanitises the same grammar in apps/api/src/agent/citations.ts. The two
// cannot share code, so both test suites replay contracts/citations.json:
// change the rule in one place and that file will fail the other.

/**
 * A bare `[slug]` citation, as the API writes it. Same rule as the server: a
 * bracket followed by `(` is a markdown link, not a citation. The optional
 * leading blank goes with a citation that is dropped.
 */
const CITATION = /([ \t]?)\[((?=[^\]]*[a-z])[a-z0-9]+(?:-[a-z0-9]+)*)\](?!\()/g;

/** A citation still being typed at the end of the streamed text: `[`, `[lau`. */
const PARTIAL_CITATION = /\[[a-z0-9-]*$/;

export type TextSegment =
  | { kind: "text"; text: string }
  | { kind: "citation"; slug: string };

/** Every distinct `[slug]` in a text, in order of first appearance. */
export function citedSlugsIn(text: string): string[] {
  const slugs = [...text.matchAll(CITATION)].map((match) => match[2] ?? "");
  return [...new Set(slugs)];
}

/**
 * Splits an answer into plain text and citations of listings we know. A
 * citation of an unknown slug is dropped (with the blank before it), so a raw
 * `[slug]` never reaches the page. While the answer is still streaming, a
 * citation that is only half written at the end is hidden until it closes.
 */
export function segmentCitations(
  text: string,
  knownSlugs: ReadonlySet<string>,
  { streaming = false }: { streaming?: boolean } = {},
): TextSegment[] {
  const visible = streaming ? text.replace(PARTIAL_CITATION, "") : text;
  const segments: TextSegment[] = [];
  const pushText = (chunk: string) => {
    if (!chunk) return;
    const last = segments.at(-1);
    if (last?.kind === "text") last.text += chunk;
    else segments.push({ kind: "text", text: chunk });
  };

  let cursor = 0;
  for (const match of visible.matchAll(CITATION)) {
    const [whole, space = "", slug = ""] = match;
    pushText(visible.slice(cursor, match.index));
    cursor = match.index + whole.length;
    if (knownSlugs.has(slug)) {
      pushText(space);
      segments.push({ kind: "citation", slug });
    }
  }
  pushText(visible.slice(cursor));
  return segments;
}

/**
 * Splits the retrieved cards into the ones the answer cited (in the order it
 * cited them) and the rest (in retrieval order).
 */
export function splitCards<TCard extends { slug: string }>(
  cards: readonly TCard[],
  citedSlugs: readonly string[],
): { cited: TCard[]; other: TCard[] } {
  const bySlug = new Map(cards.map((card) => [card.slug, card]));
  const cited: TCard[] = [];
  for (const slug of new Set(citedSlugs)) {
    const card = bySlug.get(slug);
    if (card) cited.push(card);
  }
  const shown = new Set(cited.map((card) => card.slug));
  return { cited, other: cards.filter((card) => !shown.has(card.slug)) };
}

/** The DOM id of a message's card, so a citation badge can scroll to it. */
export function cardDomId(messageId: string, slug: string): string {
  return `card-${messageId}-${slug}`;
}
