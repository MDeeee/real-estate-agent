import type { BookingsService } from '../bookings/bookings.service.js';
import type { AgentModel } from '../llm/agent-model.js';
import type { PropertyFilters } from '../properties/property-filters.schema.js';
import type { ChatCard } from './chat-card.js';
import type { AgentReplies } from './replies.js';

export interface RetrievedListing {
  card: ChatCard;
  snippet: string;
  /** Cosine similarity of the best chunk; `null` when ranked by SQL order only. */
  similarity: number | null;
}

export interface ListingRetrieval {
  retrieve(
    filters: PropertyFilters,
    semanticQuery: string,
  ): Promise<RetrievedListing[]>;
}

export interface ListingsPort {
  facets(): Promise<{ cities: string[]; compounds: string[] }>;
  /** A visible (INDEXED) listing with its full markdown body, or `null`. */
  detail(slug: string): Promise<{ card: ChatCard; body: string } | null>;
}

export interface GraphLogger {
  warn(message: string): void;
}

export interface AgentGraphDeps {
  model: AgentModel;
  retrieval: ListingRetrieval;
  listings: ListingsPort;
  bookings: Pick<BookingsService, 'create'>;
  now: () => Date;
  /** IANA name of the business time zone (`APP_TIMEZONE`): "today" and viewing hours are in it. */
  timeZone: string;
  logger: GraphLogger;
  replies: AgentReplies;
}
