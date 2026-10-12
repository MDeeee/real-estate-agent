import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import { z } from 'zod';
import {
  type PropertyFilters,
  propertyFiltersSchema,
} from '../../properties/property-filters.schema.js';
import type { AgentGraphDeps } from '../agent-graph.types.js';
import type { AgentStateType, AgentStateUpdate } from '../agent-state.js';
import { cairoToday } from '../booking-validation.js';
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

export function createExtractFiltersNode(deps: AgentGraphDeps) {
  const { model, listings, logger, now } = deps;

  return async (
    state: AgentStateType,
    config: LangGraphRunnableConfig,
  ): Promise<AgentStateUpdate> => {
    emit(config, { type: 'status', stage: 'searching' });
    const facets = await listings.facets();
    const messages = recentTurns(state.messages);
    const today = cairoToday(now());

    let validationErrors: string[] | undefined;
    let filters: PropertyFilters | undefined;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !filters; attempt += 1) {
      try {
        const raw = await model.extractFilters(
          {
            messages,
            previousFilters: state.filters,
            today,
            facets,
            validationErrors,
          },
          callOptions(config),
        );
        const parsed = propertyFiltersSchema.safeParse(
          normaliseLlmFilters(raw),
        );
        if (parsed.success) {
          filters = parsed.data;
        } else {
          validationErrors = describeIssues(parsed.error);
        }
      } catch (error) {
        if (isAborted(config)) throw error;
        validationErrors = [
          error instanceof Error ? error.message : 'Invalid structured output.',
        ];
      }
    }

    if (!filters) {
      logger.warn(
        `Filter extraction failed after ${MAX_ATTEMPTS} attempts, searching without filters: ${validationErrors?.join('; ')}`,
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
