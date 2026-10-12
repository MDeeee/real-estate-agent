/**
 * A bare `[slug]`. A `[text](url)` markdown link is not a citation (it names a
 * URL, not a listing), so a bracket followed by `(` is left alone.
 */
const CITATION = /([ \t]?)\[((?=[^\]]*[a-z])[a-z0-9]+(?:-[a-z0-9]+)*)\](?!\()/g;

export interface SanitisedAnswer {
  text: string;
  citedSlugs: string[];
  /** Citations that named no listing of this turn and were removed. */
  dropped: string[];
}

/**
 * Grounding post-check: keeps only citations that name a listing the answer
 * was allowed to use, and removes the rest from the text.
 */
export function sanitiseCitations(
  text: string,
  allowedSlugs: ReadonlySet<string>,
): SanitisedAnswer {
  const cited = new Set<string>();
  const dropped = new Set<string>();
  const cleaned = text.replace(
    CITATION,
    (match, _space: string, slug: string) => {
      if (allowedSlugs.has(slug)) {
        cited.add(slug);
        return match;
      }
      dropped.add(slug);
      return '';
    },
  );
  return {
    text: cleaned.trim(),
    citedSlugs: [...cited],
    dropped: [...dropped],
  };
}
