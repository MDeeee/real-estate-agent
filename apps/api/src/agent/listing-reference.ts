import type { CandidateRef } from '../llm/agent-model.js';
import { toLatinDigits } from './digits.js';

/** A listing slug: lowercase words joined by hyphens, at least two parts. */
export const SLUG_LIKE = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;

const ORDINAL_STEMS: [RegExp, number][] = [
  [/\b(first|1st)\b|(^|\s)(اول|الاول|اولي|الاولي)(\s|$)/, 1],
  [/\b(second|2nd)\b|ثاني|تاني/, 2],
  [/\b(third|3rd)\b|ثالث|تالت/, 3],
  [/\b(fourth|4th)\b|رابع/, 4],
  [/\b(fifth|5th)\b|خامس/, 5],
];
const STOP_WORDS = new Set([
  'the',
  'and',
  'with',
  'for',
  'one',
  'from',
  'that',
  'this',
]);
const LAST = /\b(last)\b|اخير/;
const NUMBER = /^(?:no\.?|number|option|رقم|#)?\s*(\d{1,2})$/;

function normalise(text: string): string {
  return toLatinDigits(text.toLowerCase())
    .replace(/[ً-ٟـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .trim();
}

function words(text: string): string[] {
  return normalise(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

function ordinalIndex(ref: string, count: number): number | undefined {
  if (LAST.test(ref)) return count - 1;
  for (const [pattern, ordinal] of ORDINAL_STEMS) {
    if (pattern.test(ref)) return ordinal - 1;
  }
  const digits = NUMBER.exec(ref);
  return digits?.[1] ? Number(digits[1]) - 1 : undefined;
}

/**
 * Resolves what a visitor called a listing ("the second one", a slug, a few
 * title words) against the listings last shown to them.
 */
export function resolveCandidate<T extends CandidateRef>(
  reference: string | undefined,
  candidates: readonly T[],
): T | undefined {
  if (!reference || candidates.length === 0) return undefined;
  const ref = normalise(reference);
  if (!ref) return undefined;

  const bySlug = candidates.find(
    ({ slug }) => ref === slug || ref.includes(slug),
  );
  if (bySlug) return bySlug;

  const ordinal = ordinalIndex(ref, candidates.length);
  if (ordinal !== undefined) return candidates[ordinal];

  const refWords = new Set(words(ref));
  let best: T | undefined;
  let bestScore = 0;
  let tied = false;
  for (const candidate of candidates) {
    const score = words(candidate.title).filter((word) =>
      refWords.has(word),
    ).length;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
      tied = false;
    } else if (score === bestScore && score > 0) {
      tied = true;
    }
  }
  return tied ? undefined : best;
}
