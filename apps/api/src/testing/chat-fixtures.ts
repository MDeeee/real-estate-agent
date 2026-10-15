import { vi } from 'vitest';
import { MemorySaver } from '@langchain/langgraph';
import { buildAgentGraph } from '../agent/agent-graph.js';
import type {
  AgentGraphDeps,
  RetrievedListing,
} from '../agent/agent-graph.types.js';
import type { AgentStateType } from '../agent/agent-state.js';
import type { ChatCard } from '../agent/chat-card.js';
import type { NodeEvent } from '../agent/chat-events.js';
import type { BookingSummary } from '../bookings/bookings.service.js';
import { FakeAgentModel } from './fake-agent-model.js';
import { createTestReplies } from './replies.js';

export function makeCard(
  slug: string,
  overrides: Partial<ChatCard> = {},
): ChatCard {
  return {
    id: `id-${slug}`,
    slug,
    title: `Title of ${slug}`,
    type: 'apartment',
    listing: 'SALE',
    price: 6_000_000,
    currency: 'EGP',
    bedrooms: 3,
    bathrooms: 2,
    areaM2: 180,
    city: 'New Cairo',
    district: null,
    compound: null,
    finishing: null,
    deliveryDate: null,
    paymentPlan: null,
    excerpt: `Excerpt of ${slug}`,
    ...overrides,
  };
}

export interface GraphHarness {
  model: FakeAgentModel;
  deps: AgentGraphDeps;
  retrieved: RetrievedListing[];
  createBooking: ReturnType<typeof vi.fn>;
  warnings: string[];
  graph: ReturnType<typeof buildAgentGraph>;
  checkpointer: MemorySaver;
  turn(
    threadId: string,
    message: string,
  ): Promise<{ events: NodeEvent[]; text: string; state: GraphState }>;
}

type GraphState = AgentStateType;

export const FIXED_NOW = new Date('2026-10-12T09:00:00Z');

export function createGraphHarness(
  cards: ChatCard[] = [
    makeCard('alpha-apartment'),
    makeCard('beta-apartment'),
    makeCard('gamma-apartment'),
  ],
): GraphHarness {
  const model = new FakeAgentModel();
  const retrieved: RetrievedListing[] = cards.map((card) => ({
    card,
    snippet: `Snippet of ${card.slug}`,
    similarity: 0.5,
  }));
  const warnings: string[] = [];
  const createBooking = vi.fn(
    (input: {
      threadId: string;
      propertySlug: string;
      name: string;
      phone: string;
      preferredDate: string;
      preferredTime?: string | null;
    }) => {
      const card = cards.find((c) => c.slug === input.propertySlug);
      const booking: BookingSummary = {
        id: 'cmbooking000000000000001',
        reference: '00000001',
        propertySlug: input.propertySlug,
        propertyTitle: card?.title ?? '',
        name: input.name,
        phone: input.phone,
        preferredDate: input.preferredDate,
        preferredTime: input.preferredTime ?? null,
        status: 'CONFIRMED',
      };
      return Promise.resolve({ booking, created: true });
    },
  );

  const deps: AgentGraphDeps = {
    model,
    retrieval: { retrieve: () => Promise.resolve(retrieved) },
    listings: {
      facets: () =>
        Promise.resolve({
          cities: ['New Cairo', 'Sheikh Zayed'],
          compounds: [],
        }),
      detail: (slug) => {
        const card = cards.find((c) => c.slug === slug);
        return Promise.resolve(
          card ? { card, body: `Full body of ${slug}. More text.` } : null,
        );
      },
    },
    bookings: { create: createBooking },
    now: () => FIXED_NOW,
    timeZone: 'Africa/Cairo',
    logger: { warn: (message) => warnings.push(message) },
    replies: createTestReplies(),
  };
  const checkpointer = new MemorySaver();
  const graph = buildAgentGraph(deps, checkpointer);

  return {
    model,
    deps,
    retrieved,
    createBooking,
    warnings,
    graph,
    checkpointer,
    async turn(threadId, message) {
      const events: NodeEvent[] = [];
      const stream = await graph.stream(
        { messages: [{ role: 'user', content: message }] },
        {
          configurable: { thread_id: threadId },
          streamMode: ['custom', 'values'],
          recursionLimit: 12,
        },
      );
      let state: GraphState | undefined;
      for await (const [mode, payload] of stream) {
        if (mode === 'custom') events.push(payload as NodeEvent);
        else state = payload as GraphState;
      }
      if (!state) throw new Error('graph produced no state');
      const text = state.messages.at(-1)?.text ?? '';
      return { events, text, state };
    },
  };
}
