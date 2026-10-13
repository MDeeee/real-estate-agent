import type { BookingSummary } from '../bookings/bookings.service.js';
import type { Intent } from '../llm/agent-model.js';
import type { PropertyFilters } from '../properties/property-filters.schema.js';
import type { ChatCard } from './chat-card.js';

/**
 * Why a turn failed, so the web can tell the cases apart: "provider_busy" (the
 * AI provider answered 429/503/overloaded or one call timed out),
 * "provider_unavailable" (its quota, billing or API key is exhausted or
 * rejected: waiting does not help), "timeout" (the whole turn exceeded its
 * limit), "error" (anything else).
 */
export type ChatErrorCode =
  | 'provider_busy'
  | 'provider_unavailable'
  | 'timeout'
  | 'error';

export type ChatStage = 'thinking' | 'searching' | 'booking';

export type ChatEvent =
  | { type: 'status'; stage: ChatStage }
  | { type: 'filters'; filters: PropertyFilters; semanticQuery: string }
  | { type: 'properties'; items: ChatCard[] }
  | { type: 'token'; text: string }
  | {
      type: 'booking';
      booking: BookingSummary;
      /** The localized confirmation, so it shows even when a Stop lands before `final`. */
      text: string;
    }
  | {
      type: 'final';
      text: string;
      citedSlugs: string[];
      intent: Intent | null;
    }
  | { type: 'error'; message: string; code: ChatErrorCode }
  | { type: 'done' };

/** Events a graph node emits while it runs; `final`/`error`/`done` come from the service. */
export type NodeEvent = Extract<
  ChatEvent,
  { type: 'status' | 'filters' | 'properties' | 'token' | 'booking' }
>;
