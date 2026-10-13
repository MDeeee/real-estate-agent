import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import { z } from 'zod';
import type {
  CandidateRef,
  Intent,
  UnderstandInput,
  Understanding,
} from '../../llm/agent-model.js';
import {
  isProviderBusyError,
  isProviderUnavailableError,
} from '../../llm/provider-errors.js';
import {
  type PropertyFilters,
  propertyFiltersSchema,
} from '../../properties/property-filters.schema.js';
import type { AgentGraphDeps } from '../agent-graph.types.js';
import type {
  AgentStateType,
  AgentStateUpdate,
  AssistantExtras,
} from '../agent-state.js';
import { businessToday } from '../booking-validation.js';
import { detectLanguage } from '../language.js';
import {
  SLUG_LIKE,
  resolveCandidate,
  resolveOrdinalFromMessage,
} from '../listing-reference.js';
import { dropCarriedOver, restatesFreshRequest } from '../new-search-guard.js';
import { callOptions, emit, isAborted, recentTurns } from './node-support.js';

/** One structured call, plus one retry when its output is invalid. */
const MAX_ATTEMPTS = 2;

export const NODE_FOR_INTENT = {
  search: 'retrieve',
  details: 'details',
  book: 'book',
  smalltalk: 'smalltalk',
  off_topic: 'refuse',
} as const satisfies Record<Intent, string>;

/** Structured output marks "not mentioned" with null; the search contract uses absence. */
export function normaliseLlmFilters(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(raw).filter(
      ([, value]) =>
        value !== null &&
        value !== undefined &&
        !(typeof value === 'string' && value.trim() === ''),
    ),
  );
}

function describeIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) =>
    issue.path.length > 0
      ? `${issue.path.join('.')}: ${issue.message}`
      : issue.message,
  );
}

/**
 * The fields that define WHAT is searched for; changing one starts another
 * search. The location (city, compound, district) is deliberately not one of
 * them: "in Zayed instead" moves the same search and keeps price and bedrooms.
 */
const IDENTITY_KEYS = ['listing', 'type'] as const;

function sameValue(a: unknown, b: unknown): boolean {
  return typeof a === 'string' && typeof b === 'string'
    ? a.trim().toLowerCase() === b.trim().toLowerCase()
    : a === b;
}

/**
 * Safety net for a model that called a fresh request a refinement: when the
 * extraction sets a different listing type (sale or rent) or property type
 * than the previous search, it is a new search, whatever the model said. A
 * different location alone stays a refinement.
 */
export function changesSearchIdentity(
  previous: PropertyFilters,
  next: PropertyFilters,
): boolean {
  return IDENTITY_KEYS.some((key) => {
    const before = previous[key];
    const after = next[key];
    return (
      before !== undefined && after !== undefined && !sameValue(before, after)
    );
  });
}

function hasBookingInProgress(state: AgentStateType): boolean {
  return Object.values(state.bookingDraft).some((value) => value !== undefined);
}

/**
 * The listings the visitor sees when they say "the second one": those of the
 * previous assistant turn when it showed a list, otherwise the last search's
 * candidates (a details turn shows a single card; the list is still on screen).
 */
export function shownListings(
  state: Pick<AgentStateType, 'messages' | 'candidates'>,
): CandidateRef[] {
  const previous = state.messages.findLast(
    (message) => message.getType() === 'ai',
  );
  const properties = (
    previous?.additional_kwargs as AssistantExtras | undefined
  )?.properties;
  const shown =
    properties && properties.length >= 2 ? properties : state.candidates;
  return shown.map(({ slug, title }) => ({ slug, title }));
}

/**
 * The listing the turn is about. The model's reference comes first, resolved
 * against the listings the visitor sees. Only when it names none does the
 * visitor's own wording ("the second one") fill in, for a details or book
 * turn, and never while a booking already has its property: ordinal-looking
 * words in a booking message ("2nd of November") must not switch it.
 */
export function resolvePropertyRef(
  state: AgentStateType,
  understanding: Pick<Understanding, 'intent' | 'propertyRef'>,
  latestText: string,
): string | null {
  const shown = shownListings(state);
  const reference = understanding.propertyRef;
  const resolved = resolveCandidate(reference, shown);
  if (resolved) return resolved.slug;
  if (reference && SLUG_LIKE.test(reference)) return reference;

  const ordinalAllowed =
    understanding.intent === 'details' ||
    (understanding.intent === 'book' &&
      state.bookingDraft.propertySlug === undefined);
  if (ordinalAllowed) {
    const ordinal = resolveOrdinalFromMessage(latestText, shown);
    if (ordinal) return ordinal.slug;
  }
  return reference ?? null;
}

interface Attempt {
  understanding: Understanding;
  /** Validated filters; set for a search whose filters passed the contract. */
  filters?: PropertyFilters;
  /** Why the filters were rejected, when they were. */
  errors?: string[];
}

/**
 * Understands the visitor's latest message in ONE structured LLM call: the
 * intent, the listing referred to and, for a search, its mode and filters.
 * Replaces the former `route` and `extract_filters` calls, so a search turn
 * costs two LLM calls (this one and the answer).
 */
export function createUnderstandNode(deps: AgentGraphDeps) {
  const { model, listings, logger, now, timeZone } = deps;

  return async (
    state: AgentStateType,
    config: LangGraphRunnableConfig,
  ): Promise<AgentStateUpdate> => {
    emit(config, { type: 'status', stage: 'thinking' });
    const turns = recentTurns(state.messages);
    const latestText =
      turns.findLast((turn) => turn.role === 'user')?.text ?? '';
    const facets = await listings.facets().catch((error: unknown) => {
      logger.warn(
        `Could not load the search facets: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { cities: [], compounds: [] };
    });
    const base: UnderstandInput = {
      messages: turns,
      candidates: state.candidates.map(({ slug, title }) => ({ slug, title })),
      bookingInProgress: hasBookingInProgress(state),
      previousFilters: state.filters,
      previousSemanticQuery: state.semanticQuery,
      today: businessToday(now(), timeZone),
      facets,
    };

    /**
     * One call with one retry. A provider that is busy, too slow or refusing
     * (quota, key) is never retried (the turn ends at once); an invalid answer
     * is, with the reasons.
     */
    const attempt = async (forceNewSearch: boolean): Promise<Attempt> => {
      let validationErrors: string[] | undefined;
      let last: Understanding | undefined;
      for (let n = 1; n <= MAX_ATTEMPTS; n += 1) {
        try {
          const understanding = await model.understand(
            { ...base, forceNewSearch, validationErrors },
            callOptions(config),
          );
          last = understanding;
          if (understanding.intent !== 'search') return { understanding };
          const parsed = propertyFiltersSchema.safeParse(
            normaliseLlmFilters(understanding.filters),
          );
          if (parsed.success) return { understanding, filters: parsed.data };
          validationErrors = describeIssues(parsed.error);
        } catch (error) {
          if (
            isAborted(config) ||
            isProviderBusyError(error) ||
            isProviderUnavailableError(error)
          ) {
            throw error;
          }
          // Without any understanding there is nothing to fall back on.
          if (n === MAX_ATTEMPTS && !last) throw error;
          validationErrors = [
            error instanceof Error
              ? error.message
              : 'Invalid structured output.',
          ];
        }
      }
      // Both attempts failed; `last` holds a search whose filters never validated.
      return { understanding: last as Understanding, errors: validationErrors };
    };

    let result = await attempt(false);
    if (
      result.understanding.intent === 'search' &&
      result.understanding.searchMode === 'refine' &&
      result.filters &&
      restatesFreshRequest({
        previousFilters: state.filters,
        filters: result.filters,
        latestMessage: latestText,
      })
    ) {
      // A complete request that restates sale/rent and names a type is a new
      // search even when the model called it a refinement; the carry-over
      // guard below drops what it copied from the old search.
      result = {
        ...result,
        understanding: { ...result.understanding, searchMode: 'new' },
      };
    } else if (
      result.understanding.intent === 'search' &&
      result.understanding.searchMode === 'refine' &&
      result.filters &&
      changesSearchIdentity(state.filters, result.filters)
    ) {
      // The visitor changed what is searched for: keep only what they restate.
      // This rare path is the one case where a search turn makes a third call.
      try {
        const fresh = await attempt(true);
        if (fresh.understanding.intent === 'search' && fresh.filters) {
          result = {
            ...fresh,
            understanding: { ...fresh.understanding, searchMode: 'new' },
          };
        }
      } catch (error) {
        if (isAborted(config)) throw error;
        // The first understanding is valid: treat it as a new search and let
        // the carry-over guard below drop what was copied from the old one.
        logger.warn(
          `The forced new-search understanding failed, using the first one as a new search: ${error instanceof Error ? error.message : String(error)}`,
        );
        result = {
          ...result,
          understanding: { ...result.understanding, searchMode: 'new' },
        };
      }
    }

    const { understanding } = result;
    // Decided from the visitor's own letters, not by the (unreliable) model.
    const language = detectLanguage(latestText, state.language);
    const common: AgentStateUpdate = {
      intent: understanding.intent,
      language,
      propertyRef: resolvePropertyRef(state, understanding, latestText),
      citedSlugs: [],
    };
    if (understanding.intent !== 'search') return common;

    let filters = result.filters;
    let semanticQuery = understanding.semanticQuery;
    if (!filters) {
      logger.warn(
        `Filter extraction failed after ${MAX_ATTEMPTS} attempts, searching without filters: ${result.errors?.join('; ')}`,
      );
      filters = {};
    } else if (understanding.searchMode === 'new') {
      // A new search carries nothing over, whatever the model copied.
      const guarded = dropCarriedOver({
        previousFilters: state.filters,
        previousSemanticQuery: state.semanticQuery,
        filters,
        semanticQuery,
        latestMessage: latestText,
      });
      if (guarded.dropped.length > 0) {
        logger.warn(
          `A new search carried over from the previous one; dropped: ${guarded.dropped.join(', ')}`,
        );
      }
      filters = guarded.filters;
      semanticQuery = guarded.semanticQuery;
    }
    emit(config, { type: 'status', stage: 'searching' });
    emit(config, {
      type: 'filters',
      filters,
      semanticQuery,
    });
    return {
      ...common,
      searchMode: understanding.searchMode,
      semanticQuery,
      filters,
    };
  };
}
