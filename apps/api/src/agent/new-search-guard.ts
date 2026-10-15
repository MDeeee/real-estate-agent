import type { PropertyFilters } from '../properties/property-filters.schema.js';
import { toLatinDigits } from './digits.js';

/**
 * The model sees the whole conversation and the previous filters, so it can
 * leak them into a NEW search ("3 bedroom apartment for sale" after "villa for
 * rent in Zayed under 50k" keeping Zayed and 50k). This guard is the
 * deterministic backstop: a value of a new search that equals the previous
 * search's value for the same key stays only when the visitor's own latest
 * message gives evidence for it.
 */

function normalise(text: string): string {
  return toLatinDigits(text.toLowerCase())
    .replace(/[٬،]/g, ',')
    .replace(/٫/g, '.')
    .replace(/[ً-ٟـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}

function tokens(text: string): string[] {
  return text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function sameValue(a: unknown, b: unknown): boolean {
  return typeof a === 'string' && typeof b === 'string'
    ? a.trim().toLowerCase() === b.trim().toLowerCase()
    : a === b;
}

/** Other names a visitor uses for the places the listings are in. */
const LOCATION_ALIASES: Record<string, string[]> = {
  'sheikh zayed': ['zayed', 'الشيخ زايد', 'شيخ زايد', 'زايد'],
  'new cairo': [
    'tagamoa',
    'tagamo3',
    'التجمع',
    'القاهره الجديده',
    'fifth settlement',
  ],
  'fifth settlement': ['التجمع الخامس', '5th settlement', 'tagamoa'],
  '6th of october': ['october', 'اكتوبر', '6 oct', 'السادس من اكتوبر'],
  'new administrative capital': ['capital', 'العاصمه الاداريه', 'العاصمه'],
  'north coast': ['sahel', 'الساحل'],
  maadi: ['المعادي'],
  zamalek: ['الزمالك'],
  'ain sokhna': ['sokhna', 'السخنه'],
};

function locationEvidence(value: string, message: string): boolean {
  const wanted = normalise(value).trim();
  if (!wanted) return false;
  if (message.includes(wanted)) return true;
  if (LOCATION_ALIASES[wanted]?.some((alias) => message.includes(alias))) {
    return true;
  }
  // "Laurel" for "Laurel Hills": any word of the name, once it is distinctive.
  const messageWords = new Set(tokens(message));
  return tokens(wanted).some(
    (word) => word.length >= 4 && messageWords.has(word),
  );
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
  واحد: 1,
  واحده: 1,
  اتنين: 2,
  اثنين: 2,
  تلات: 3,
  تلاته: 3,
  ثلاث: 3,
  ثلاثه: 3,
  اربع: 4,
  اربعه: 4,
  خمس: 5,
  خمسه: 5,
  ست: 6,
  سته: 6,
  سبع: 7,
  سبعه: 7,
  تمان: 8,
  تمانيه: 8,
  ثمان: 8,
  تسع: 9,
  تسعه: 9,
  عشر: 10,
  عشره: 10,
  مليونين: 2_000_000,
  الفين: 2000,
};

const WORD_MULTIPLIERS: [RegExp, number][] = [
  [/^(?:million|millions|mn|مليون|ملايين)$/u, 1_000_000],
  [/^(?:thousand|thousands|الف|الاف)$/u, 1000],
];
/** "k" and "m" are also units ("250 m2"), so both readings are kept. */
const LETTER_MULTIPLIERS: Record<string, number> = { k: 1000, m: 1_000_000 };

/** Every number the message states, in every reading that is plausible. */
function numbersIn(rawMessage: string): number[] {
  const message = normalise(rawMessage).replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
  const found: number[] = [];
  for (const match of message.matchAll(
    /(?<![\p{L}\p{N}.])(\d+(?:\.\d+)?)\s*([\p{L}]*)/gu,
  )) {
    const amount = Number(match[1]);
    const unit = match[2] ?? '';
    const word = WORD_MULTIPLIERS.find(([pattern]) => pattern.test(unit));
    if (word) {
      found.push(amount * word[1]);
      continue;
    }
    found.push(amount);
    // "850k", "5m" are amounts, "250 m" is an area: keep both readings.
    const multiplier = LETTER_MULTIPLIERS[unit];
    if (multiplier) found.push(amount * multiplier);
  }
  for (const word of tokens(message)) {
    const value = NUMBER_WORDS[word];
    if (value !== undefined) found.push(value);
  }
  return found;
}

const TYPE_WORDS: Record<string, RegExp> = {
  apartment:
    /apartment|appartment|\bapt\b|\bflat|\bsha[2q]{1,2}a|shaqqa|شقه|شقق|شقت/u,
  villa: /villa|\bvila|فيلا|فيلات|فيلل|فيله/u,
  townhouse: /town ?house|تاون ?هاوس/u,
  duplex: /duplex|dubl[ei]x|دوبلكس/u,
  chalet: /chalet|\bshal[ei]+[ht]|شاليه/u,
  studio: /studio|استوديو|ستوديو/u,
  office: /office|\bma[kc]tab|مكتب|مكاتب/u,
};

/**
 * Words that name properties in general ("properties", "listings", "عقارات",
 * "وحدات"), not a kind of property.
 */
const GENERIC_PROPERTY_WORDS =
  /(?<![\p{L}\p{N}])(?:(?:propert(?:y|ies)|listings?|homes?|houses?|units?|real estate)|(?:ال)?(?:عقارات|عقار|وحدات|وحده))(?![\p{L}\p{N}])/u;

function namesAnyType(message: string): boolean {
  return Object.values(TYPE_WORDS).some((pattern) => pattern.test(message));
}

/**
 * The message speaks of properties in general ("properties for sale in Sheikh
 * Zayed") and names no kind of property: it asks for no type at all.
 */
export function asksForAnyPropertyType(latestMessage: string): boolean {
  const message = normalise(latestMessage);
  return GENERIC_PROPERTY_WORDS.test(message) && !namesAnyType(message);
}

const LISTING_WORDS: Record<string, RegExp> = {
  RENT: /\b(?:rent|rental|renting|lease|leasing)\b|ايجار|اجار/u,
  SALE: /\b(?:buy|buying|sale|purchase|own|ownership)\b|بيع|تمليك|شراء|اشتري/u,
};

const LOCATION_KEYS = ['city', 'compound', 'district'] as const;
const NUMERIC_KEYS = [
  'priceMin',
  'priceMax',
  'bedroomsMin',
  'bathroomsMin',
  'areaMin',
  'areaMax',
] as const;

function hasEvidence(
  key: keyof PropertyFilters,
  value: unknown,
  message: string,
  numbers: number[],
): boolean {
  if ((LOCATION_KEYS as readonly string[]).includes(key)) {
    return typeof value === 'string' && locationEvidence(value, message);
  }
  if ((NUMERIC_KEYS as readonly string[]).includes(key)) {
    return (
      typeof value === 'number' &&
      numbers.some((number) => Math.abs(number - value) < 1e-6)
    );
  }
  if (key === 'type') {
    return (
      typeof value === 'string' && TYPE_WORDS[value]?.test(message) === true
    );
  }
  if (key === 'listing') {
    return (
      typeof value === 'string' &&
      LISTING_WORDS[value.toUpperCase()]?.test(message) === true
    );
  }
  return false;
}

/**
 * A refinement the model mislabelled: the previous search named no property
 * type, and the latest message on its own restates the deal (sale or rent) AND
 * names a property type, without mentioning any place of the previous search.
 * "3 bedroom apartment for sale under 12 million" after "properties for sale
 * in Sheikh Zayed" is a complete new request; "only apartments" or "in New
 * Cairo only" are narrowings and stay refinements.
 */
export function restatesFreshRequest(input: {
  previousFilters: PropertyFilters;
  filters: PropertyFilters;
  latestMessage: string;
}): boolean {
  const { previousFilters, filters } = input;
  if (previousFilters.type !== undefined) return false;
  if (filters.type === undefined || filters.listing === undefined) return false;
  const message = normalise(input.latestMessage);
  if (
    TYPE_WORDS[filters.type]?.test(message) !== true ||
    LISTING_WORDS[filters.listing.toUpperCase()]?.test(message) !== true
  ) {
    return false;
  }
  return !LOCATION_KEYS.some((key) => {
    const place = previousFilters[key];
    return typeof place === 'string' && locationEvidence(place, message);
  });
}

/**
 * A generic request ("properties for sale in Sheikh Zayed") after a search that
 * had a type: a new search when it also restates the deal or a place. A bare
 * "show me properties with a garden" stays a refinement (its type is still
 * cleared by `dropUnsupportedType`).
 */
export function restatesGenericRequest(input: {
  previousFilters: PropertyFilters;
  filters: PropertyFilters;
  latestMessage: string;
}): boolean {
  const { previousFilters, filters } = input;
  if (previousFilters.type === undefined) return false;
  if (!asksForAnyPropertyType(input.latestMessage)) return false;
  const message = normalise(input.latestMessage);
  const restatesDeal =
    filters.listing !== undefined &&
    LISTING_WORDS[filters.listing.toUpperCase()]?.test(message) === true;
  const restatesPlace = LOCATION_KEYS.some((key) => {
    const place = filters[key];
    return typeof place === 'string' && locationEvidence(place, message);
  });
  return restatesDeal || restatesPlace;
}

/**
 * A property type is kept only when the visitor's latest message gives
 * evidence for it ("villa", "فيلا"), or when a refinement keeps the previous
 * search's type and the message is not a generic request. This removes a type
 * the model invented for "properties in Sheikh Zayed" or kept after "show me
 * properties in ...". Works for new searches and refinements alike.
 */
export function dropUnsupportedType(input: {
  previousFilters: PropertyFilters;
  filters: PropertyFilters;
  searchMode: 'new' | 'refine';
  latestMessage: string;
}): { filters: PropertyFilters; dropped: boolean } {
  const { filters } = input;
  if (filters.type === undefined) return { filters, dropped: false };
  const message = normalise(input.latestMessage);
  if (TYPE_WORDS[filters.type]?.test(message) === true) {
    return { filters, dropped: false };
  }
  const keepsPrevious =
    input.searchMode === 'refine' &&
    sameValue(input.previousFilters.type, filters.type) &&
    !asksForAnyPropertyType(input.latestMessage);
  if (keepsPrevious) return { filters, dropped: false };
  const { type: _dropped, ...rest } = filters;
  return { filters: rest, dropped: true };
}

export interface CarryOverResult {
  filters: PropertyFilters;
  semanticQuery: string;
  /** The keys (and "semanticQuery") that were removed. */
  dropped: string[];
}

/**
 * Removes what a NEW search copied from the previous one without the visitor
 * saying it again in `latestMessage`. Call it for a `new` search only.
 */
export function dropCarriedOver(input: {
  previousFilters: PropertyFilters;
  previousSemanticQuery: string;
  filters: PropertyFilters;
  semanticQuery: string;
  latestMessage: string;
}): CarryOverResult {
  const message = normalise(input.latestMessage);
  const numbers = numbersIn(input.latestMessage);
  const dropped: string[] = [];

  const kept = Object.fromEntries(
    Object.entries(input.filters).filter(([key, value]) => {
      const before = input.previousFilters[key as keyof PropertyFilters];
      if (before === undefined || !sameValue(before, value)) return true;
      if (hasEvidence(key as keyof PropertyFilters, value, message, numbers)) {
        return true;
      }
      dropped.push(key);
      return false;
    }),
  ) as PropertyFilters;

  let semanticQuery = input.semanticQuery;
  const previousQuery = input.previousSemanticQuery.trim();
  if (
    previousQuery !== '' &&
    sameValue(previousQuery, semanticQuery.trim()) &&
    !queryEvidence(previousQuery, message)
  ) {
    semanticQuery = '';
    dropped.push('semanticQuery');
  }
  return { filters: kept, semanticQuery, dropped };
}

/** The preferences are restated: the whole text, or at least half of its words. */
function queryEvidence(query: string, message: string): boolean {
  const wanted = normalise(query).trim();
  if (message.includes(wanted)) return true;
  const messageWords = new Set(tokens(message));
  const significant = tokens(wanted).filter((word) => word.length >= 4);
  if (significant.length === 0) return false;
  const present = significant.filter((word) => messageWords.has(word)).length;
  return present >= Math.ceil(significant.length / 2);
}
