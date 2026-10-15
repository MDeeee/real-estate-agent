import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { ConfigService } from '@nestjs/config';
import { BookingsService } from '../bookings/bookings.service.js';
import type { Env } from '../config/env.schema.js';
import { AGENT_MODEL, type AgentModel } from '../llm/agent-model.js';
import { PropertySearchService } from '../properties/property-search.service.js';
import { AgentRetrievalService } from './agent-retrieval.service.js';
import { type AgentGraph, buildAgentGraph } from './agent-graph.js';
import type { ListingsPort } from './agent-graph.types.js';
import { toChatCard } from './chat-card.js';
import { CheckpointerService } from './checkpointer.service.js';
import { AgentReplies } from './replies.js';
import { ttlCached } from './ttl-cache.js';

const MAX_FACET_VALUES = 100;
/** Facets change only on ingestion; a short TTL spares a query on every search turn. */
export const FACETS_TTL_MS = 60_000;

@Injectable()
export class AgentGraphService {
  readonly graph: AgentGraph;
  /** The checkpoint store behind `graph`; failed first turns are purged from it. */
  readonly checkpointer: BaseCheckpointSaver;
  private readonly logger = new Logger('Agent');

  constructor(
    @Inject(CheckpointerService) checkpointer: CheckpointerService,
    @Inject(AGENT_MODEL) model: AgentModel,
    @Inject(AgentRetrievalService) retrieval: AgentRetrievalService,
    @Inject(PropertySearchService) search: PropertySearchService,
    @Inject(BookingsService) bookings: BookingsService,
    @Inject(ConfigService) config: ConfigService<Env, true>,
    @Inject(AgentReplies) replies: AgentReplies,
  ) {
    const listings: ListingsPort = {
      facets: ttlCached(FACETS_TTL_MS, async () => {
        const facets = await search.facets();
        return {
          cities: facets.cities.slice(0, MAX_FACET_VALUES).map((f) => f.value),
          compounds: facets.compounds
            .slice(0, MAX_FACET_VALUES)
            .map((f) => f.value),
        };
      }),
      detail: async (slug) => {
        try {
          const { body, ...card } = await search.findBySlug(slug);
          return { card: toChatCard(card), body };
        } catch (error) {
          if (error instanceof NotFoundException) return null;
          throw error;
        }
      },
    };

    this.checkpointer = checkpointer.saver;
    this.graph = buildAgentGraph(
      {
        model,
        retrieval,
        listings,
        bookings,
        now: () => new Date(),
        timeZone: config.get('APP_TIMEZONE', { infer: true }),
        logger: this.logger,
        replies,
      },
      checkpointer.saver,
    );
  }
}
