/**
 * The listings an answer may cite. One definition for the graph nodes and the
 * eval harness, so the evals judge groundedness by exactly the production rule.
 */

/** A search answer may cite the listings retrieved for this turn. */
export function searchGroundingSlugs(
  candidates: readonly { slug: string }[],
): Set<string> {
  return new Set(candidates.map(({ slug }) => slug));
}

/** A details answer may cite only the listing whose card it was given. */
export function detailsGroundingSlugs(cardSlug: string): Set<string> {
  return new Set([cardSlug]);
}
