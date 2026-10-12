import type { ChatCard } from '../agent/chat-card.js';
import type { PropertyFilters } from '../properties/property-filters.schema.js';

export const AGENT_MODEL = Symbol('AGENT_MODEL');

export const INTENTS = [
  'search',
  'details',
  'book',
  'smalltalk',
  'off_topic',
] as const;
export type Intent = (typeof INTENTS)[number];

export const LANGUAGES = ['ar', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

export interface ConversationTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface CandidateRef {
  slug: string;
  title: string;
}

export interface BookingDraft {
  propertySlug?: string | undefined;
  name?: string | undefined;
  phone?: string | undefined;
  preferredDate?: string | undefined;
  /** `HH:mm`, 24 h, inside the viewing hours. */
  preferredTime?: string | undefined;
  /** The visitor said any time suits them: no time is stored. */
  anyTime?: boolean | undefined;
}

/** Token counters one chat turn accumulates across every model call. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ModelCallOptions {
  signal?: AbortSignal | undefined;
  usage?: TokenUsage | undefined;
}

export interface ClassifyInput {
  messages: ConversationTurn[];
  candidates: CandidateRef[];
  bookingInProgress: boolean;
  /** Qualitative preferences of the current search (empty when there are none). */
  previousSemanticQuery: string;
}

export interface Classification {
  intent: Intent;
  /**
   * The FULL current qualitative preferences to rank by meaning (previous ones
   * carried over unless the visitor replaced or dropped them); empty when none.
   */
  semanticQuery: string;
  /** A slug, ordinal ("the second one") or title words naming a listing. */
  propertyRef: string | undefined;
}

export interface ExtractFiltersInput {
  messages: ConversationTurn[];
  previousFilters: PropertyFilters;
  today: string;
  facets: { cities: string[]; compounds: string[] };
  /** Validation errors of the previous attempt, when this is the retry. */
  validationErrors?: string[] | undefined;
}

export interface BookingExtractionInput {
  /**
   * The conversation BEFORE the visitor's latest message: context for the
   * name, phone, date and listing only. Never a source of the time.
   */
  history: ConversationTurn[];
  /** The visitor's latest message: the only source of the time fields. */
  latestMessage: string;
  draft: BookingDraft;
  candidates: CandidateRef[];
  /** Today's date in the business time zone, `YYYY-MM-DD`, for relative dates like "next Sunday". */
  today: string;
  /** IANA name of the business time zone the dates and times are in. */
  timeZone: string;
}

export interface BookingExtraction {
  propertyRef?: string | undefined;
  name?: string | undefined;
  phone?: string | undefined;
  /** `YYYY-MM-DD` as understood by the model; still to be validated. */
  preferredDate?: string | undefined;
  /**
   * `HH:mm` (24 h) as understood by the model; still to be validated. Taken
   * from the latest message only.
   */
  preferredTime?: string | undefined;
  /** The latest message explicitly says any time suits ("any time"). */
  anyTime?: boolean | undefined;
  /**
   * The latest message names only a vague part of the day ("evening", "after
   * work", "after 6") that cannot be turned into one clock time.
   */
  timeVague?: boolean | undefined;
}

export interface ListingContext {
  card: ChatCard;
  /** Best-matching passage of the listing's description. */
  snippet: string;
}

export interface AnswerInput {
  language: Language;
  messages: ConversationTurn[];
  filters: PropertyFilters;
  listings: ListingContext[];
}

export interface DetailsInput {
  language: Language;
  messages: ConversationTurn[];
  card: ChatCard;
  /** The listing's full markdown description. */
  body: string;
}

/**
 * The only seam through which the application talks to an LLM. Tests replace it
 * with a fake; production uses the LangChain implementation.
 */
export interface AgentModel {
  /** `false` when the selected provider lacks its credentials. */
  isConfigured(): boolean;
  classify(
    input: ClassifyInput,
    options?: ModelCallOptions,
  ): Promise<Classification>;
  /**
   * Raw structured output: every filter key is present, `null` meaning "not
   * mentioned". The caller normalises and validates it.
   */
  extractFilters(
    input: ExtractFiltersInput,
    options?: ModelCallOptions,
  ): Promise<Record<string, unknown>>;
  extractBooking(
    input: BookingExtractionInput,
    options?: ModelCallOptions,
  ): Promise<BookingExtraction>;
  streamAnswer(
    input: AnswerInput,
    options?: ModelCallOptions,
  ): AsyncIterable<string>;
  answerDetails(
    input: DetailsInput,
    options?: ModelCallOptions,
  ): AsyncIterable<string>;
}
