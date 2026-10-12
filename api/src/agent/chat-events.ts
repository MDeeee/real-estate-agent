import type { BookingSummary } from '../bookings/bookings.service.js';
import type { Intent } from '../llm/agent-model.js';
import type { PropertyFilters } from '../properties/property-filters.schema.js';
import type { ChatCard } from './chat-card.js';

export type ChatStage = 'thinking' | 'searching' | 'booking';

export type ChatEvent =
  | { type: 'status'; stage: ChatStage }
  | { type: 'filters'; filters: PropertyFilters; semanticQuery: string }
  | { type: 'properties'; items: ChatCard[] }
  | { type: 'token'; text: string }
  | { type: 'booking'; booking: BookingSummary }
  | {
      type: 'final';
      text: string;
      citedSlugs: string[];
      intent: Intent | null;
    }
  | { type: 'error'; message: string }
  | { type: 'done' };

/** Events a graph node emits while it runs; `final`/`error`/`done` come from the service. */
export type NodeEvent = Extract<
  ChatEvent,
  { type: 'status' | 'filters' | 'properties' | 'token' | 'booking' }
>;
