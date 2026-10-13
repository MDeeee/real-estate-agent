import { Inject, Injectable } from '@nestjs/common';
import { ChunkRepository } from '../ingestion/chunk.repository.js';
import {
  EMBEDDINGS_PORT,
  type EmbeddingsPort,
} from '../ingestion/embeddings.port.js';
import type { PropertyFilters } from '../properties/property-filters.schema.js';
import { PropertySearchService } from '../properties/property-search.service.js';
import type {
  ListingRetrieval,
  RetrievedListing,
} from './agent-graph.types.js';
import { toChatCard } from './chat-card.js';

export const CANDIDATE_POOL_SIZE = 50;
export const RESULT_LIMIT = 5;

/**
 * Filter-then-rank retrieval (ADR 0004): the structured filters pick the
 * candidates exactly as the regular search does, vector similarity then orders
 * them by how well their text matches the visitor's wishes.
 */
@Injectable()
export class AgentRetrievalService implements ListingRetrieval {
  constructor(
    @Inject(PropertySearchService)
    private readonly search: PropertySearchService,
    @Inject(ChunkRepository) private readonly chunks: ChunkRepository,
    @Inject(EMBEDDINGS_PORT) private readonly embeddings: EmbeddingsPort,
  ) {}

  async retrieve(
    filters: PropertyFilters,
    semanticQuery: string,
  ): Promise<RetrievedListing[]> {
    const { items } = await this.search.search(filters, {
      pageSize: CANDIDATE_POOL_SIZE,
      sort: 'newest',
    });
    const sqlOrder: RetrievedListing[] = items.map((card) => ({
      card: toChatCard(card),
      snippet: card.excerpt,
      similarity: null,
    }));

    const query = semanticQuery.trim();
    if (!query || items.length === 0) return sqlOrder.slice(0, RESULT_LIMIT);

    const vector = await this.embeddings.embedQuery(query);
    const ranked = await this.chunks.rankProperties(
      items.map(({ id }) => id),
      vector,
      RESULT_LIMIT,
    );
    const byId = new Map(sqlOrder.map((entry, i) => [items[i]?.id, entry]));
    const results: RetrievedListing[] = [];
    for (const { propertyId, chunkContent, similarity } of ranked) {
      const entry = byId.get(propertyId);
      if (entry) results.push({ ...entry, snippet: chunkContent, similarity });
    }
    return results.length > 0 ? results : sqlOrder.slice(0, RESULT_LIMIT);
  }
}
