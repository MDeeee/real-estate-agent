import { randomUUID } from 'node:crypto';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import {
  BookingCancelledError,
  PropertyUnavailableError,
} from '../bookings/bookings.service.js';
import { classifyMessages } from '../llm/prompts.js';
import { createGraphHarness } from '../testing/chat-fixtures.js';
import { MAX_STORED_MESSAGES, trimNode } from './nodes/trim.js';

describe('agent graph', () => {
  it('searches: extracts filters, retrieves, answers and cites only candidates', async () => {
    const h = createGraphHarness();
    const { events, text, state } = await h.turn(
      randomUUID(),
      '3 bedroom apartment in New Cairo under 7 million',
    );

    expect(state.intent).toBe('search');
    expect(state.filters).toEqual({
      city: 'New Cairo',
      type: 'apartment',
      bedroomsMin: 3,
      priceMax: 7_000_000,
    });
    expect(events.map((e) => e.type)).toEqual([
      'status',
      'status',
      'filters',
      'properties',
      ...Array(4).fill('token'),
    ]);
    expect(events[0]).toEqual({ type: 'status', stage: 'thinking' });
    expect(events[1]).toEqual({ type: 'status', stage: 'searching' });
    expect(text).toContain('[alpha-apartment]');
    expect(state.citedSlugs).toEqual([
      'alpha-apartment',
      'beta-apartment',
      'gamma-apartment',
    ]);
    expect(state.candidates.map((c) => c.slug)).toEqual([
      'alpha-apartment',
      'beta-apartment',
      'gamma-apartment',
    ]);
  });

  it('passes the previous filters on a refinement and keeps the full set', async () => {
    const h = createGraphHarness();
    const thread = randomUUID();
    await h.turn(thread, '3 bedroom apartment in New Cairo under 7 million');
    const { state } = await h.turn(thread, 'something cheaper');

    expect(h.model.filterCalls.at(-1)?.previousFilters).toMatchObject({
      city: 'New Cairo',
      priceMax: 7_000_000,
    });
    expect(state.filters).toEqual({
      city: 'New Cairo',
      type: 'apartment',
      bedroomsMin: 3,
      priceMax: 5_000_000,
    });
  });

  it('retries filter extraction once with the validation errors, then succeeds', async () => {
    const h = createGraphHarness();
    h.model.filterQueue = [
      { city: 'New Cairo', priceMin: 9_000_000, priceMax: 1_000_000 },
      { city: 'New Cairo', priceMin: null, priceMax: 9_000_000 },
    ];
    const { state } = await h.turn(randomUUID(), 'apartments in New Cairo');

    expect(h.model.filterCalls).toHaveLength(2);
    expect(h.model.filterCalls[0]?.validationErrors).toBeUndefined();
    expect(h.model.filterCalls[1]?.validationErrors?.join(' ')).toContain(
      'priceMin must not be greater than priceMax',
    );
    expect(state.filters).toEqual({ city: 'New Cairo', priceMax: 9_000_000 });
    expect(h.warnings).toEqual([]);
  });

  it('proceeds with empty filters and logs after a second failure', async () => {
    const h = createGraphHarness();
    h.model.filterQueue = [
      { priceMin: 5, priceMax: 1 },
      new Error('model returned garbage'),
    ];
    const { state, events } = await h.turn(randomUUID(), 'apartments');

    expect(h.model.filterCalls).toHaveLength(2);
    expect(state.filters).toEqual({});
    expect(h.warnings).toHaveLength(1);
    expect(h.warnings[0]).toContain('model returned garbage');
    expect(events.find((e) => e.type === 'filters')).toMatchObject({
      filters: {},
    });
  });

  it('drops citations of listings that were not retrieved', async () => {
    const h = createGraphHarness();
    h.model.answerSuffix = 'Also see [ghost-listing].';
    const { text, state } = await h.turn(
      randomUUID(),
      'apartments in New Cairo',
    );

    expect(text).not.toContain('ghost-listing');
    expect(state.citedSlugs).not.toContain('ghost-listing');
    expect(h.warnings.join(' ')).toContain('ghost-listing');
  });

  it('answers details about "the second one" from the full body', async () => {
    const h = createGraphHarness();
    const thread = randomUUID();
    await h.turn(thread, 'apartments in New Cairo');
    const { text, events, state } = await h.turn(
      thread,
      'tell me more about the second one',
    );

    expect(state.intent).toBe('details');
    expect(h.model.detailsCalls.at(-1)?.card.slug).toBe('beta-apartment');
    expect(h.model.detailsCalls.at(-1)?.body).toContain(
      'Full body of beta-apartment',
    );
    expect(text).toContain('[beta-apartment]');
    expect(state.citedSlugs).toEqual(['beta-apartment']);
    expect(events.find((e) => e.type === 'properties')).toMatchObject({
      items: [{ slug: 'beta-apartment' }],
    });
  });

  it('asks which listing is meant when nothing has been shown', async () => {
    const h = createGraphHarness();
    const { text } = await h.turn(
      randomUUID(),
      'tell me more about the second one',
    );
    expect(text).toContain('Which listing');
    expect(h.model.detailsCalls).toHaveLength(0);
  });

  it('refuses off-topic requests without searching', async () => {
    const h = createGraphHarness();
    const { text, state, events } = await h.turn(
      randomUUID(),
      'what is the weather today?',
    );

    expect(state.intent).toBe('off_topic');
    expect(text).toContain('real estate');
    expect(h.model.filterCalls).toHaveLength(0);
    expect(events.map((e) => e.type)).toEqual(['status']);
  });

  it('replies to smalltalk in the visitor language', async () => {
    const h = createGraphHarness();
    h.model.classify = () =>
      Promise.resolve({
        intent: 'smalltalk',
        language: 'ar',
        semanticQuery: '',
        propertyRef: undefined,
      });
    const { text } = await h.turn(randomUUID(), 'hello');
    expect(text).toMatch(/[؀-ۿ]/);
  });

  describe('booking', () => {
    async function searchFirst() {
      const h = createGraphHarness();
      const thread = randomUUID();
      await h.turn(thread, 'apartments in New Cairo');
      return { h, thread };
    }

    it('collects the details over several messages, then confirms and clears the draft', async () => {
      const { h, thread } = await searchFirst();

      const first = await h.turn(thread, 'I want to book the second one');
      expect(first.state.bookingDraft).toEqual({
        propertySlug: 'beta-apartment',
      });
      expect(first.text).toContain('your full name');
      expect(first.text).toContain('mobile number');
      expect(first.text).toContain('preferred viewing date');
      expect(h.createBooking).not.toHaveBeenCalled();

      const second = await h.turn(thread, 'my name is Test User, 01001234567');
      expect(second.state.intent).toBe('book');
      expect(second.state.bookingDraft).toMatchObject({
        propertySlug: 'beta-apartment',
        name: 'Test User',
        phone: '01001234567',
      });
      expect(second.text).toContain('preferred viewing date');
      expect(second.text).not.toContain('your full name');

      const third = await h.turn(thread, '2026-10-19');
      expect(h.createBooking).toHaveBeenCalledOnce();
      expect(h.createBooking).toHaveBeenCalledWith({
        threadId: thread,
        propertySlug: 'beta-apartment',
        name: 'Test User',
        phone: '01001234567',
        preferredDate: '2026-10-19',
      });
      expect(third.state.bookingDraft).toEqual({});
      expect(third.text).toContain('00000001');
      expect(third.events.find((e) => e.type === 'booking')).toBeDefined();
    });

    it('asks again for an invalid phone and an out-of-window date', async () => {
      const { h, thread } = await searchFirst();
      await h.turn(thread, 'book the first one');

      const bad = await h.turn(
        thread,
        'my name is Test User, 12345678901 on 2026-10-12',
      );
      expect(bad.text).toContain('Egyptian mobile number');
      expect(bad.text).toContain('after today');
      expect(bad.state.bookingDraft.phone).toBeUndefined();
      expect(bad.state.bookingDraft.preferredDate).toBeUndefined();
      expect(bad.state.bookingDraft.name).toBe('Test User');

      const far = await h.turn(thread, '01001234567 2027-03-01');
      expect(far.text).toContain('90 days');
      expect(h.createBooking).not.toHaveBeenCalled();
    });

    it('does not book a listing that disappeared and drops it from the draft', async () => {
      const { h, thread } = await searchFirst();
      h.createBooking.mockRejectedValueOnce(
        new PropertyUnavailableError('alpha-apartment'),
      );
      const { text, state } = await h.turn(
        thread,
        'book the first one, my name is Test User, 01001234567 2026-10-19',
      );
      expect(text).toContain('no longer available');
      expect(state.bookingDraft.propertySlug).toBeUndefined();
      expect(state.bookingDraft.name).toBe('Test User');
    });

    it('tells the visitor a cancelled slot stays cancelled, in English and Arabic', async () => {
      const { h, thread } = await searchFirst();
      h.createBooking.mockRejectedValueOnce(new BookingCancelledError('0001'));
      const { text, state } = await h.turn(
        thread,
        'book the first one, my name is Test User, 01001234567 2026-10-19',
      );
      expect(text).toBe(
        'That slot was cancelled by our team — please choose another date.',
      );
      expect(state.bookingDraft.preferredDate).toBeUndefined();
      expect(state.bookingDraft.name).toBe('Test User');
      expect(state.bookingDraft.propertySlug).toBe('alpha-apartment');

      const arabic = createGraphHarness();
      const arThread = randomUUID();
      await arabic.turn(arThread, 'apartments in New Cairo');
      arabic.createBooking.mockRejectedValueOnce(
        new BookingCancelledError('0001'),
      );
      const ar = await arabic.turn(
        arThread,
        'احجز my name is Test User, 01001234567 2026-10-19 the first one',
      );
      expect(ar.text).toContain('اتلغى');
    });

    it('asks which listing when none can be identified', async () => {
      const h = createGraphHarness();
      const { text } = await h.turn(randomUUID(), 'I want to book a viewing');
      expect(text).toContain('which listing');
    });

    it('tells the router a booking is in progress', async () => {
      const { h, thread } = await searchFirst();
      await h.turn(thread, 'book the third one');
      await h.turn(thread, 'my name is Test User');
      expect(h.model.classifyCalls.at(-1)?.bookingInProgress).toBe(true);
    });
  });

  describe('semantic preferences', () => {
    it('keeps "garden view" when the visitor only asks for something cheaper', async () => {
      const h = createGraphHarness();
      const thread = randomUUID();
      const first = await h.turn(thread, 'apartment with a garden view');
      expect(first.state.semanticQuery).toBe('garden view');

      const { state } = await h.turn(thread, 'something cheaper');

      expect(h.model.classifyCalls.at(-1)?.previousSemanticQuery).toBe(
        'garden view',
      );
      expect(state.semanticQuery).toBe('garden view');
      expect(state.filters.priceMax).toBe(5_000_000);
    });

    it('lets the visitor drop the preferences, and non-search turns keep them', async () => {
      const h = createGraphHarness();
      const thread = randomUUID();
      await h.turn(thread, 'apartment with a garden view');

      const chat = await h.turn(thread, 'thanks');
      expect(chat.state.intent).toBe('smalltalk');
      expect(chat.state.semanticQuery).toBe('garden view');

      const dropped = await h.turn(thread, 'forget the view, in New Cairo');
      expect(dropped.state.semanticQuery).toBe('');
    });

    it('tells the model about the previous preferences in the router prompt', async () => {
      const [system] = classifyMessages({
        messages: [{ role: 'user', text: 'cheaper' }],
        candidates: [],
        bookingInProgress: false,
        previousSemanticQuery: 'garden view',
      });
      expect(system?.content).toContain(
        'Previous qualitative preferences: garden view',
      );
      expect(system?.content).toContain('FULL current qualitative preferences');
    });
  });

  describe('bounded history', () => {
    it('stores at most 20 messages after 15 turns', async () => {
      const h = createGraphHarness();
      const thread = randomUUID();
      let lastState;
      for (let turn = 1; turn <= 15; turn += 1) {
        lastState = (await h.turn(thread, `hello ${turn}`)).state;
        expect(lastState.messages.length).toBeLessThanOrEqual(20);
      }
      const stored = await h.graph.getState({
        configurable: { thread_id: thread },
      });
      expect(stored.values.messages.length).toBeLessThanOrEqual(20);
      expect(stored.values.messages.length).toBe(20);
      expect(stored.values.messages[0]?.getType()).toBe('human');
      // The newest exchange is kept.
      expect(stored.values.messages.at(-2)?.text).toBe('hello 15');
    });

    it('trimNode starts the kept window with a visitor message', async () => {
      const messages = Array.from({ length: 23 }, (_, i) =>
        i % 2 === 0
          ? new HumanMessage({ id: `m${i}`, content: `q${i}` })
          : new AIMessage({ id: `m${i}`, content: `a${i}` }),
      );
      const update = trimNode({ messages } as never);
      const removed = (update.messages as { id: string }[]).map((m) => m.id);
      // 23 -> keep the last 20 (m3..m22), but m3 is an AI reply, so m3 goes too.
      expect(removed).toEqual(['m0', 'm1', 'm2', 'm3']);
      expect(23 - removed.length).toBeLessThanOrEqual(MAX_STORED_MESSAGES);
      expect(trimNode({ messages: messages.slice(0, 20) } as never)).toEqual({});
    });
  });

  it('stores cards and the search summary on assistant messages for history', async () => {
    const h = createGraphHarness();
    const { state } = await h.turn(randomUUID(), 'apartments in New Cairo');
    const last = state.messages.at(-1);
    expect(last?.additional_kwargs['properties']).toHaveLength(3);
    expect(last?.additional_kwargs['search']).toMatchObject({
      filters: { city: 'New Cairo', type: 'apartment' },
    });
  });
});
