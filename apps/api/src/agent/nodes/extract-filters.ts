import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import { z } from 'zod';
import {
  type PropertyFilters,
  propertyFiltersSchema,
} from '../../properties/property-filters.schema.js';
import type { SearchMode } from '../../llm/agent-model.js';
import type { AgentGraphDeps } from '../agent-graph.types.js';
import type { AgentStateType, AgentStateUpdate } from '../agent-state.js';
import { businessToday } from '../booking-validation.js';
import { callOptions, emit, isAborted, recentTurns } from './node-support.js';

const MAX_ATTEMPTS = 2;

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
 * Safety net for a router that called a fresh request a refinement: when the
 * extraction sets a different listing type (sale or rent) or property type
 * than the previous search, it is a new search, whatever the router said. A
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

export function createExtractFiltersNode(deps: AgentGraphDeps) {
  const { model, listings, logger, now, timeZone } = deps;

  return async (
    state: AgentStateType,
    config: LangGraphRunnableConfig,
  ): Promise<AgentStateUpdate> => {
    emit(config, { type: 'status', stage: 'searching' });
    const facets = await listings.facets();
    const turns = recentTurns(state.messages);
    const today = businessToday(now(), timeZone);

    /** One extraction (with one retry); `undefined` when both attempts failed. */
    const extract = async (
      searchMode: SearchMode,
    ): Promise<{ filters?: PropertyFilters; errors?: string[] }> => {
      const refine = searchMode === 'refine';
      // A new search sees only the latest request, so nothing can leak from earlier turns.
      const latest = turns.findLast((turn) => turn.role === 'user');
      const messages = refine || !latest ? turns : [latest];
      let validationErrors: string[] | undefined;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
          const raw = await model.extractFilters(
            {
              messages,
              searchMode,
              previousFilters: refine ? state.filters : {},
              previousSemanticQuery: refine ? state.semanticQuery : '',
              today,
              facets,
              validationErrors,
            },
            callOptions(config),
          );
          const parsed = propertyFiltersSchema.safeParse(
            normaliseLlmFilters(raw),
          );
          if (parsed.success) return { filters: parsed.data };
          validationErrors = describeIssues(parsed.error);
        } catch (error) {
          if (isAborted(config)) throw error;
          validationErrors = [
            error instanceof Error
              ? error.message
              : 'Invalid structured output.',
          ];
        }
      }
      return { errors: validationErrors ?? [] };
    };

    let result = await extract(state.searchMode);
    if (
      state.searchMode === 'refine' &&
      result.filters &&
      changesSearchIdentity(state.filters, result.filters)
    ) {
      // The visitor changed what is searched for: keep only what they restate.
      const fresh = await extract('new');
      if (fresh.filters) result = fresh;
    }

    let filters = result.filters;
    if (!filters) {
      logger.warn(
        `Filter extraction failed after ${MAX_ATTEMPTS} attempts, searching without filters: ${result.errors?.join('; ')}`,
      );
      filters = {};
    }

    emit(config, {
      type: 'filters',
      filters,
      semanticQuery: state.semanticQuery,
    });
    return { filters };
  };
}
