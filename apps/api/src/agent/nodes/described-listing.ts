import type {
  ListingRetrieval,
  RetrievedListing,
} from '../agent-graph.types.js';
import type { ListingLookup } from '../agent-state.js';
import { titleWordOverlap } from '../listing-reference.js';

/** How many listings are offered when none is a clear match. */
export const OFFERED_LISTINGS = 3;
/** A title must share this many distinctive words with the message... */
const MIN_TITLE_OVERLAP = 3;
/** ...and beat the runner-up by this many, to be chosen among several. */
const MIN_LEAD = 2;

export interface DescribedListing {
  /** The listing the visitor clearly described; absent when none is clear. */
  chosen?: RetrievedListing;
  /** Otherwise the best few to ask about (empty when nothing matches). */
  options: RetrievedListing[];
}

/**
 * Resolves a property the visitor described ("the Nile-view apartment in
 * Zamalek") when no listing is on screen, with the search's own retrieval
 * (filters, then vector ranking). The top result is accepted only when:
 *  - it is the ONLY result of a search that had filters, or
 *  - its title shares at least three distinctive words with the message and
 *    two more than the runner-up (so "apartment in Zamalek" alone, which fits
 *    a sale and a rental listing alike, is never guessed).
 * Otherwise nothing is chosen and the best few titles are offered.
 */
export async function chooseDescribedListing(
  retrieval: ListingRetrieval,
  lookup: ListingLookup,
  message: string,
): Promise<DescribedListing> {
  const results = await retrieval.retrieve(
    lookup.filters,
    lookup.semanticQuery,
  );
  const [only] = results;
  if (results.length === 1 && only && Object.keys(lookup.filters).length > 0) {
    return { chosen: only, options: [] };
  }
  const scored = results
    .map((result) => ({
      result,
      score: titleWordOverlap(message, result.card.title),
    }))
    .sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  if (
    best &&
    best.score >= MIN_TITLE_OVERLAP &&
    best.score - (second?.score ?? 0) >= MIN_LEAD
  ) {
    return { chosen: best.result, options: [] };
  }
  return { options: results.slice(0, OFFERED_LISTINGS) };
}
