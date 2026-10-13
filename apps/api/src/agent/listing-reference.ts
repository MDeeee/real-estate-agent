import type { CandidateRef } from '../llm/agent-model.js';
import { toLatinDigits } from './digits.js';

/** A listing slug: lowercase words joined by hyphens, at least two parts. */
export const SLUG_LIKE = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;

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

  // A reference is the model's own phrase, so a bare "2" is allowed here.
  const ordinal = ordinalIndexFromMessage(ref, candidates.length, {
    bareNumber: true,
  });
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

/** 1-based position, or the last listing shown. */
type Position = number | 'last';

const WORD_START = String.raw`(?<![\p{L}\p{N}])`;
const WORD_END = String.raw`(?![\p{L}\p{N}])`;

const EN_POSITIONS: Record<string, Position> = {
  first: 1,
  '1st': 1,
  second: 2,
  '2nd': 2,
  third: 3,
  '3rd': 3,
  fourth: 4,
  '4th': 4,
  fifth: 5,
  '5th': 5,
  last: 'last',
};
const EN_ORDINAL = new RegExp(
  `${WORD_START}(${Object.keys(EN_POSITIONS).join('|')})${WORD_END}`,
  'gu',
);
/** What an English ordinal may be followed by when it names a listing. */
const EN_LISTING_NOUNS = new Set([
  'one',
  'ones',
  'listing',
  'option',
  'property',
  'apartment',
  'villa',
  'flat',
  'unit',
  'home',
  'house',
  'duplex',
  'chalet',
]);
/**
 * Words that make an ordinal something else: a date ("2nd of November"), a
 * period, an amount or a part of a listing or a person ("last name").
 */
const EN_NOT_A_LISTING = new Set([
  'of',
  'name',
  'surname',
  'day',
  'week',
  'month',
  'year',
  'quarter',
  'time',
  'installment',
  'instalment',
  'payment',
  'floor',
  'bedroom',
  'bathroom',
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]);
/** Words a message may start with and still be "just" the ordinal. */
const EN_FILLER = new Set([
  'and',
  'the',
  'what',
  'how',
  'about',
  'then',
  'ok',
  'okay',
  'so',
  'but',
  'please',
  'i',
  'like',
  'prefer',
  'want',
  'take',
  'tell',
  'me',
  'more',
  'show',
]);

/** Optional Arabic prefix of an ordinal: "ال" (the), "وال", "بال", "لل" (to the). */
const AR_THE = '(?:[وفبك]?ال|لل)';
const AR_POSITIONS: [string, Position][] = [
  ['اول[يه]?', 1],
  ['(?:ثاني|تاني)ه?', 2],
  ['(?:ثالث|تالت)ه?', 3],
  ['رابعه?', 4],
  ['خامسه?', 5],
  ['اخيره?', 'last'],
];
const AR_ORDINAL = new RegExp(
  `${WORD_START}${AR_THE}(${AR_POSITIONS.map(([stem]) => `(?:${stem})`).join('|')})${WORD_END}`,
  'gu',
);
const AR_MONTHS =
  'يناير|فبراير|مارس|ابريل|مايو|يونيو|يوليو|اغسطس|سبتمبر|اكتوبر|نوفمبر|ديسمبر';
/** Month, day, instalment, floor... in Arabic: what the ordinal then counts. */
const AR_UNIT = `(?:ال)?(?:شهر|يوم|قسط|دور|اسبوع|سنه|غرفه|اوضه|حمام|${AR_MONTHS})`;
const AR_UNIT_AFTER = new RegExp(`^\\s+(?:من\\s+)?${AR_UNIT}${WORD_END}`, 'u');
const AR_UNIT_BEFORE = new RegExp(`${WORD_START}${AR_UNIT}\\s+$`, 'u');

/** "number 2", "no. 3", "option 2", "#4", "رقم 5". */
const NUMBERED =
  /(?<![\p{L}\p{N}])(?:number|no\.|option|#|رقم)\s*(\d{1,2})(?!\d)/gu;
const NUMBER_NOT_A_LISTING_BEFORE = new Set([
  'phone',
  'mobile',
  'whatsapp',
  'floor',
  'building',
  'apartment',
  'unit',
  'house',
  'villa',
  'flat',
  'room',
  'bedroom',
  'id',
  'order',
  'booking',
  'reference',
  'ref',
  'card',
]);
const NUMBER_NOT_A_LISTING_AFTER = new Set([
  'bedroom',
  'bedrooms',
  'bed',
  'beds',
  'bath',
  'baths',
  'floor',
  'egp',
  'million',
  'year',
  'years',
  'month',
  'months',
  'day',
  'days',
  'installments',
  'k',
  'm',
]);

function wordAfter(rest: string): string | undefined {
  return /^\s+([\p{L}\p{N}]+)/u.exec(rest)?.[1];
}

function wordBefore(text: string): string | undefined {
  return /([\p{L}\p{N}]+)\s*$/u.exec(text)?.[1];
}

/** Only the ordinal was said: nothing before it but filler, nothing after it. */
function isJustTheOrdinal(before: string, after: string): boolean {
  if (/[\p{L}\p{N}]/u.test(after)) return false;
  return before
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .every((word) => EN_FILLER.has(word));
}

interface Mention {
  position: Position;
  /** The words around it say it names a listing. */
  names: boolean;
}

/**
 * The ONE place that decides whether a text names a listing by its position.
 * Only unambiguous forms count: an ordinal followed by one/listing/option/
 * property/apartment/..., "number N" or "#N", the bare ordinal as the whole
 * message, and the definite Arabic ordinals (الأول, التانية, الثالث...).
 * Ordinals that are plainly something else ("2nd of November", "my last name",
 * "the first installment", "تاني" meaning "another", "اول الشهر") are ignored.
 */
function mentionsOf(message: string, bareNumber: boolean): Mention[] {
  const mentions: Mention[] = [];

  for (const match of message.matchAll(EN_ORDINAL)) {
    const position = EN_POSITIONS[match[1] ?? ''];
    if (position === undefined) continue;
    const before = message.slice(0, match.index);
    const after = message.slice(match.index + match[0].length);
    const next = wordAfter(after);
    if (next !== undefined && EN_NOT_A_LISTING.has(next)) continue;
    mentions.push({
      position,
      names:
        (next !== undefined && EN_LISTING_NOUNS.has(next)) ||
        isJustTheOrdinal(before, after),
    });
  }

  for (const match of message.matchAll(AR_ORDINAL)) {
    const stem = match[1] ?? '';
    const position = AR_POSITIONS.find(([pattern]) =>
      new RegExp(`^(?:${pattern})$`, 'u').test(stem),
    )?.[1];
    if (position === undefined) continue;
    const after = message.slice(match.index + match[0].length);
    const before = message.slice(0, match.index);
    if (AR_UNIT_AFTER.test(after) || AR_UNIT_BEFORE.test(before)) continue;
    mentions.push({ position, names: true });
  }

  for (const match of message.matchAll(NUMBERED)) {
    const before = message.slice(0, match.index);
    const after = message.slice(match.index + match[0].length);
    const previous = wordBefore(before);
    const next = wordAfter(after);
    if (
      (previous !== undefined && NUMBER_NOT_A_LISTING_BEFORE.has(previous)) ||
      (next !== undefined && NUMBER_NOT_A_LISTING_AFTER.has(next))
    ) {
      continue;
    }
    mentions.push({ position: Number(match[1]), names: true });
  }

  const bare = /^[^\p{L}\p{N}]*(\d{1,2})[^\p{L}\p{N}]*$/u.exec(message)?.[1];
  if (bareNumber && bare !== undefined) {
    mentions.push({ position: Number(bare), names: true });
  }
  return mentions;
}

/**
 * The position (0-based) of the listing a text names by order: "the second
 * one", "the last listing", "التاني", "الأولى", "number 3", "رقم 2". See
 * `mentionsOf` for what counts. `undefined` when the text names no position,
 * names two different ones (an ordinal that does not name a listing still
 * makes it ambiguous), or the position is beyond the `count` listings shown.
 * English and Egyptian Arabic.
 */
export function ordinalIndexFromMessage(
  text: string,
  count: number,
  { bareNumber = false }: { bareNumber?: boolean } = {},
): number | undefined {
  const mentions = mentionsOf(normalise(text), bareNumber);
  const resolved = (position: Position) =>
    position === 'last' ? count - 1 : position - 1;
  const distinct = new Set(mentions.map(({ position }) => resolved(position)));
  if (distinct.size !== 1 || !mentions.some(({ names }) => names)) {
    return undefined;
  }
  const [index] = [...distinct];
  return index !== undefined && index >= 0 && index < count ? index : undefined;
}

/**
 * The listing a visitor's latest message names by position, resolved against
 * the listings shown in the previous assistant turn (display order).
 */
export function resolveOrdinalFromMessage<T extends CandidateRef>(
  text: string,
  shown: readonly T[],
): T | undefined {
  const index = ordinalIndexFromMessage(text, shown.length);
  return index === undefined ? undefined : shown[index];
}
