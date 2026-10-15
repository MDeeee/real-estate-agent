import { randomUUID } from 'node:crypto';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import {
  BookingCancelledError,
  PropertyUnavailableError,
} from '../bookings/bookings.service.js';
import { ProviderBusyError } from '../llm/provider-errors.js';
import { understandMessages } from '../llm/prompts.js';
import { createGraphHarness, makeCard } from '../testing/chat-fixtures.js';
import { changesSearchIdentity } from './nodes/understand.js';
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
        searchMode: 'refine',
        semanticQuery: '',
        propertyRef: undefined,
      });
    const { text, state } = await h.turn(randomUUID(), 'مرحبا');
    expect(state.language).toBe('ar');
    expect(text).toMatch(/[؀-ۿ]/);
  });

  describe('reply language', () => {
    it('answers an English question in English, whatever the classifier says', async () => {
      const h = createGraphHarness();
      h.model.classify = () =>
        Promise.resolve({
          intent: 'off_topic',
          semanticQuery: '',
          propertyRef: undefined,
          // A small model once answered English questions in Arabic; extra
          // fields from such a classifier are ignored.
          language: 'ar',
        } as never);
      const { text, state } = await h.turn(
        randomUUID(),
        'what is the weather in Cairo?',
      );
      expect(state.language).toBe('en');
      expect(text).toContain('Sorry, I can only help with real estate');
      expect(text).not.toMatch(/[؀-ۿ]/);
    });

    it('passes the detected language to the answer prompt', async () => {
      const h = createGraphHarness();
      const thread = randomUUID();
      await h.turn(thread, 'apartments in New Cairo');
      expect(h.model.answerCalls.at(-1)?.language).toBe('en');
      await h.turn(thread, 'شقة للإيجار في الشيخ زايد');
      expect(h.model.answerCalls.at(-1)?.language).toBe('ar');
    });

    it('treats a mixed message by its share of Arabic letters', async () => {
      const h = createGraphHarness();
      const { state } = await h.turn(randomUUID(), 'شقة in Zayed');
      expect(state.language).toBe('ar');
    });

    it('keeps the conversation language when a message has no letters', async () => {
      const h = createGraphHarness();
      const thread = randomUUID();
      await h.turn(thread, 'مرحبا');
      h.model.classify = () =>
        Promise.resolve({
          intent: 'book',
          searchMode: 'refine',
          semanticQuery: '',
          propertyRef: undefined,
        });
      const { state, text } = await h.turn(thread, '01001234567');
      expect(state.language).toBe('ar');
      expect(text).toMatch(/[؀-ۿ]/);
    });

    it('keeps Arabic for short or Arabizi replies inside an Arabic conversation', async () => {
      const h = createGraphHarness();
      const thread = randomUUID();
      await h.turn(thread, 'عايز شقة للإيجار');
      for (const reply of [
        'Ahmed Ali',
        'ok',
        'Mivida',
        '3ayez sha2a fe New Cairo',
      ]) {
        const { state } = await h.turn(thread, reply);
        expect(state.language, reply).toBe('ar');
      }
      expect(h.model.answerCalls.at(-1)?.language).toBe('ar');
    });

    it('switches to English when the visitor writes a full English sentence', async () => {
      const h = createGraphHarness();
      const thread = randomUUID();
      await h.turn(thread, 'عايز شقة للإيجار');
      const { state } = await h.turn(
        thread,
        'I am looking for a villa in New Cairo please',
      );
      expect(state.language).toBe('en');
    });
  });

  describe('booking', () => {
    async function searchFirst(
      cards = ['alpha-apartment', 'beta-apartment', 'gamma-apartment'],
    ) {
      const h = createGraphHarness(cards.map((slug) => makeCard(slug)));
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

      // Name, phone and date are complete, so the optional time is asked once.
      const third = await h.turn(thread, '2026-10-19');
      expect(h.createBooking).not.toHaveBeenCalled();
      expect(third.text).toContain('time of day');
      expect(third.text).toContain('any time');
      expect(third.state.bookingDraft).toMatchObject({
        preferredDate: '2026-10-19',
      });

      const fourth = await h.turn(thread, 'book it for 17:00');
      expect(h.createBooking).toHaveBeenCalledOnce();
      expect(h.createBooking).toHaveBeenCalledWith({
        threadId: thread,
        propertySlug: 'beta-apartment',
        name: 'Test User',
        phone: '01001234567',
        preferredDate: '2026-10-19',
        preferredTime: '17:00',
      });
      expect(fourth.state.bookingDraft).toEqual({});
      expect(fourth.text).toContain('00000001');
      expect(fourth.text).toContain('Monday, 19 October 2026 at 17:00');
      const bookingEvent = fourth.events.find((e) => e.type === 'booking');
      expect(bookingEvent).toBeDefined();
      // The event carries the very confirmation the turn stores, so the web
      // can show it even when Stop lands before `final`.
      expect(bookingEvent).toMatchObject({ text: fourth.text });
    });

    it('books straight away when the time comes with the other details', async () => {
      const { h, thread } = await searchFirst();
      const { text } = await h.turn(
        thread,
        'book the first one, my name is Test User, 01001234567 2026-10-19 9:30',
      );
      expect(h.createBooking).toHaveBeenCalledWith(
        expect.objectContaining({ preferredTime: '09:30' }),
      );
      expect(text).toContain('Monday, 19 October 2026 at 09:30');
    });

    it('accepts "any time" and stores no time', async () => {
      const { h, thread } = await searchFirst();
      await h.turn(
        thread,
        'book the first one, my name is Test User, 01001234567 2026-10-19',
      );
      expect(h.createBooking).not.toHaveBeenCalled();

      const { text } = await h.turn(thread, 'book it, any time is fine');
      expect(h.createBooking).toHaveBeenCalledWith(
        expect.objectContaining({
          preferredDate: '2026-10-19',
          preferredTime: null,
        }),
      );
      expect(text).toContain('Monday, 19 October 2026 (any time)');
    });

    it('keeps asking for the time: a reply without one does not book', async () => {
      const { h, thread } = await searchFirst();
      const asked = await h.turn(
        thread,
        'book the first one, my name is Test User, 01001234567 2026-10-19',
      );
      expect(asked.text).toContain('time of day');

      const again = await h.turn(thread, 'please book it');
      expect(h.createBooking).not.toHaveBeenCalled();
      expect(again.text).toContain('e.g. 18:00');
      expect(again.text).toContain('any time');
    });

    it('does not ask for the time while other details are still missing', async () => {
      const { h, thread } = await searchFirst();
      const { text, state } = await h.turn(
        thread,
        'I want to book the second one',
      );
      expect(text).toContain('your full name');
      expect(text).not.toContain('time of day');
      expect(state.bookingDraft).toEqual({ propertySlug: 'beta-apartment' });
    });

    it('rejects a time outside 09:00-21:00 and asks again', async () => {
      const { h, thread } = await searchFirst();
      const early = await h.turn(
        thread,
        'book the first one, my name is Test User, 01001234567 2026-10-19 08:59',
      );
      expect(early.text).toContain('between 09:00 and 21:00');
      expect(early.state.bookingDraft.preferredTime).toBeUndefined();

      const late = await h.turn(thread, 'book it 21:01');
      expect(late.text).toContain('between 09:00 and 21:00');
      expect(h.createBooking).not.toHaveBeenCalled();

      await h.turn(thread, 'book it 21:00');
      expect(h.createBooking).toHaveBeenCalledWith(
        expect.objectContaining({ preferredTime: '21:00' }),
      );
    });

    it('rejects a time of day that does not exist', async () => {
      const { h, thread } = await searchFirst();
      const { text } = await h.turn(
        thread,
        'book the first one, my name is Test User, 01001234567 2026-10-19 25:00',
      );
      expect(text).toContain('could not read that time');
      expect(h.createBooking).not.toHaveBeenCalled();
    });

    it('tells the extraction model the business time zone and today', async () => {
      const { h, thread } = await searchFirst();
      await h.turn(thread, 'book the first one');
      expect(h.model.bookingCalls.at(-1)).toMatchObject({
        today: '2026-10-12',
        timeZone: 'Africa/Cairo',
      });
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
        'book the first one, my name is Test User, 01001234567 2026-10-19 17:00',
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
        'book the first one, my name is Test User, 01001234567 2026-10-19 17:00',
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
        'احجز لي الوحدة دي my name is Test User, 01001234567 2026-10-19 17:00 the first one',
      );
      expect(ar.text).toContain('اتلغى');
    });

    it('asks which listing when none can be identified', async () => {
      const h = createGraphHarness();
      const { text } = await h.turn(randomUUID(), 'I want to book a viewing');
      expect(text).toContain('which listing');
    });

    describe('time of the viewing', () => {
      const ALL_BUT_TIME =
        'book the first one, my name is Test User, 01001234567 2026-10-19';

      it('books with the time of a message that has everything', async () => {
        const { h, thread } = await searchFirst();
        await h.turn(thread, `${ALL_BUT_TIME} 17:00`);
        expect(h.createBooking).toHaveBeenCalledWith(
          expect.objectContaining({ preferredTime: '17:00' }),
        );
      });

      it('keeps a stored time when the next message does not mention one', async () => {
        const { h, thread } = await searchFirst();
        const first = await h.turn(
          thread,
          'book the first one, my name is Test User, 17:00',
        );
        expect(first.state.bookingDraft.preferredTime).toBe('17:00');
        await h.turn(thread, '01001234567 2026-10-19');
        expect(h.createBooking).toHaveBeenCalledWith(
          expect.objectContaining({ preferredTime: '17:00' }),
        );
      });

      it('an explicit time clears "any time", and "any time" clears the time', async () => {
        const { h, thread } = await searchFirst();
        const any = await h.turn(
          thread,
          'book the first one, my name is Test User, any time',
        );
        expect(any.state.bookingDraft).toMatchObject({ anyTime: true });
        expect(any.state.bookingDraft.preferredTime).toBeUndefined();

        const timed = await h.turn(thread, 'make it 17:00');
        expect(timed.state.bookingDraft.preferredTime).toBe('17:00');
        expect(timed.state.bookingDraft.anyTime).toBeUndefined();

        const back = await h.turn(thread, 'actually any time is fine');
        expect(back.state.bookingDraft).toMatchObject({ anyTime: true });
        expect(back.state.bookingDraft.preferredTime).toBeUndefined();
        expect(h.createBooking).not.toHaveBeenCalled();
      });

      it('"any time" followed by "actually 22:00" is rejected and clears both', async () => {
        const { h, thread } = await searchFirst();
        await h.turn(
          thread,
          'book the first one, my name is Test User, any time',
        );
        const late = await h.turn(thread, 'actually 22:00');
        expect(late.text).toContain('between 09:00 and 21:00');
        expect(late.state.bookingDraft.preferredTime).toBeUndefined();
        expect(late.state.bookingDraft.anyTime).toBeUndefined();
        expect(late.text).toContain('any time');

        // The rest of the details alone cannot book: a time is still needed.
        const rest = await h.turn(thread, '01001234567 2026-10-19');
        expect(h.createBooking).not.toHaveBeenCalled();
        expect(rest.text).toContain('time of day');

        await h.turn(thread, 'book it 21:00');
        expect(h.createBooking).toHaveBeenCalledWith(
          expect.objectContaining({ preferredTime: '21:00' }),
        );
      });

      it('an invalid time clears a stored time and a stored "any time"', async () => {
        const { h, thread } = await searchFirst();
        await h.turn(thread, 'book the first one, my name is Test User, 17:00');
        const invalid = await h.turn(thread, 'how about 25:00');
        expect(invalid.text).toContain('could not read that time');
        expect(invalid.state.bookingDraft.preferredTime).toBeUndefined();
        expect(invalid.state.bookingDraft.anyTime).toBeUndefined();

        await h.turn(thread, 'any time');
        const bad = await h.turn(thread, 'or 08:59');
        expect(bad.state.bookingDraft.preferredTime).toBeUndefined();
        expect(bad.state.bookingDraft.anyTime).toBeUndefined();
        expect(bad.text).toContain('between 09:00 and 21:00');
      });

      it('"any time" wins over a garbage time from a small model', async () => {
        const { h, thread } = await searchFirst();
        await h.turn(thread, ALL_BUT_TIME);
        h.model.bookingQueue.push({
          name: 'Test User',
          preferredTime: 'anyTime',
          anyTime: true,
        });
        const { text } = await h.turn(thread, 'any time please');
        expect(h.createBooking).toHaveBeenCalledWith(
          expect.objectContaining({ preferredTime: null }),
        );
        expect(text).toContain('(any time)');
      });

      it('an unparseable time without "any time" is rejected, not stored', async () => {
        const { h, thread } = await searchFirst();
        await h.turn(thread, ALL_BUT_TIME);
        h.model.bookingQueue.push({ preferredTime: 'anyTime', anyTime: false });
        const { text, state } = await h.turn(thread, 'whenever');
        expect(h.createBooking).not.toHaveBeenCalled();
        expect(text).toContain('could not read that time');
        expect(state.bookingDraft.preferredTime).toBeUndefined();
      });

      it('reads the time from the latest message only (the QA loop)', async () => {
        const { h, thread } = await searchFirst();
        const rejected = await h.turn(thread, `${ALL_BUT_TIME} 23:00`);
        expect(rejected.text).toContain('between 09:00 and 21:00');

        await h.turn(thread, 'any time');
        const call = h.model.bookingCalls.at(-1);
        expect(call?.latestMessage).toBe('any time');
        expect(call?.history.map((turn) => turn.text).join(' ')).toContain(
          '23:00',
        );
        expect(h.createBooking).toHaveBeenCalledWith(
          expect.objectContaining({ preferredTime: null }),
        );
      });

      it.each(['in the evening', 'after work', 'after 6'])(
        'does not store the vague time "%s" and asks for an exact one',
        async (vague) => {
          const { h, thread } = await searchFirst();
          await h.turn(thread, ALL_BUT_TIME);
          const { text, state } = await h.turn(thread, `book it ${vague}`);
          expect(h.createBooking).not.toHaveBeenCalled();
          expect(text).toContain('exact time');
          expect(text).toContain('e.g. 18:00');
          expect(text).toContain('any time');
          expect(state.bookingDraft.preferredTime).toBeUndefined();
          expect(state.bookingDraft.anyTime).toBeUndefined();
        },
      );

      it('a vague time replaces a stored time, and an exact one then books', async () => {
        const { h, thread } = await searchFirst();
        await h.turn(thread, 'book the first one, my name is Test User, 17:00');
        const vague = await h.turn(thread, 'maybe in the evening');
        expect(vague.state.bookingDraft.preferredTime).toBeUndefined();
        await h.turn(thread, '01001234567 2026-10-19 18:00');
        expect(h.createBooking).toHaveBeenCalledWith(
          expect.objectContaining({ preferredTime: '18:00' }),
        );
      });
    });

    describe('which listing is booked', () => {
      it('switches the draft to a listing named later and keeps the details', async () => {
        const { h, thread } = await searchFirst();
        const first = await h.turn(
          thread,
          'book the second one, my name is Test User, 01001234567',
        );
        expect(first.state.bookingDraft.propertySlug).toBe('beta-apartment');

        const switched = await h.turn(thread, 'actually the third one');
        expect(switched.state.bookingDraft).toMatchObject({
          propertySlug: 'gamma-apartment',
          name: 'Test User',
          phone: '01001234567',
        });

        await h.turn(thread, '2026-10-19 17:00');
        expect(h.createBooking).toHaveBeenCalledWith(
          expect.objectContaining({
            propertySlug: 'gamma-apartment',
            name: 'Test User',
          }),
        );
      });

      it('prefers the listing the visitor names over the one the extractor echoes from the draft', async () => {
        const { h, thread } = await searchFirst();
        await h.turn(thread, 'book the second one, my name is Test User');
        h.model.bookingQueue.push({ propertyRef: 'beta-apartment' });
        const { state } = await h.turn(thread, 'no, book the third one');
        expect(state.bookingDraft.propertySlug).toBe('gamma-apartment');
      });

      it.each([
        ['two new results', ['delta-villa', 'echo-villa']],
        ['a single new result', ['delta-villa']],
      ])(
        'asks which listing after a new search left the draft listing behind (%s)',
        async (_name, slugs) => {
          const { h, thread } = await searchFirst([
            'alpha-apartment',
            'beta-apartment',
            'gamma-apartment',
            'delta-villa',
            'echo-villa',
          ]);
          await h.turn(
            thread,
            'book the second one, my name is Test User, 01001234567 2026-10-19',
          );

          h.retrieved.splice(
            0,
            h.retrieved.length,
            ...slugs.map((slug) => ({
              card: makeCard(slug),
              snippet: `Snippet of ${slug}`,
              similarity: 0.5,
            })),
          );
          await h.turn(thread, 'villas in New Cairo');
          const { text, state } = await h.turn(thread, 'book it');

          expect(h.createBooking).not.toHaveBeenCalled();
          expect(state.bookingDraft.propertySlug).toBeUndefined();
          expect(state.bookingDraft).toMatchObject({
            name: 'Test User',
            phone: '01001234567',
            preferredDate: '2026-10-19',
          });
          expect(text).toContain('which listing');
          for (const slug of slugs) expect(text).toContain(`Title of ${slug}`);
          expect(text).not.toContain('Title of beta-apartment');

          if (slugs.length === 2) {
            await h.turn(thread, 'the second one, any time');
            expect(h.createBooking).toHaveBeenCalledWith(
              expect.objectContaining({
                propertySlug: 'echo-villa',
                name: 'Test User',
                preferredDate: '2026-10-19',
              }),
            );
          }
        },
      );

      it('keeps the draft listing while it is still among the results', async () => {
        const { h, thread } = await searchFirst();
        await h.turn(thread, 'book the second one, my name is Test User');
        const { state } = await h.turn(thread, '01001234567');
        expect(state.bookingDraft.propertySlug).toBe('beta-apartment');
      });
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
      const [system] = understandMessages({
        messages: [{ role: 'user', text: 'cheaper' }],
        candidates: [],
        bookingInProgress: false,
        previousFilters: {},
        previousSemanticQuery: 'garden view',
        today: '2026-10-12',
        facets: { cities: [], compounds: [] },
      });
      expect(system?.content).toContain(
        'Previous qualitative preferences (not a filter): garden view',
      );
      expect(system?.content).toContain('FULL current qualitative preferences');
    });
  });

  describe('new search or refinement', () => {
    it('starts a self-contained request from scratch: nothing is carried over', async () => {
      const h = createGraphHarness();
      const thread = randomUUID();
      await h.turn(
        thread,
        '3 bedroom apartment in Sheikh Zayed for rent under 7 million',
      );

      const { state } = await h.turn(
        thread,
        'apartment for sale under 12 million',
      );

      expect(state.searchMode).toBe('new');
      const call = h.model.filterCalls.at(-1);
      expect(call?.searchMode).toBe('new');
      // The (fake) model leaks the previous filters, like a real one can...
      expect(call?.previousFilters).toMatchObject({ city: 'Sheikh Zayed' });
      // ...and the carry-over guard removes what the visitor did not restate.
      expect(state.filters).toEqual({
        type: 'apartment',
        listing: 'SALE',
        priceMax: 12_000_000,
      });
    });

    it('drops the values a new search leaked from the previous one', async () => {
      const h = createGraphHarness();
      const thread = randomUUID();
      await h.turn(
        thread,
        '3 bedroom apartment in Sheikh Zayed for rent under 7 million',
      );

      const { state, events } = await h.turn(thread, 'apartment for sale');

      expect(state.searchMode).toBe('new');
      // City, bedrooms and budget leaked and were not restated.
      expect(state.filters).toEqual({ type: 'apartment', listing: 'SALE' });
      expect(events.find((e) => e.type === 'filters')).toMatchObject({
        filters: { type: 'apartment', listing: 'SALE' },
      });
      expect(h.warnings.join(' ')).toContain('city');
    });

    it('keeps a value the new search restates', async () => {
      const h = createGraphHarness();
      const thread = randomUUID();
      await h.turn(
        thread,
        '3 bedroom apartment in Sheikh Zayed for rent under 7 million',
      );

      const { state } = await h.turn(
        thread,
        'apartment for sale in Sheikh Zayed under 7 million',
      );

      expect(state.searchMode).toBe('new');
      // The city and the budget are said again; the bedrooms are not.
      expect(state.filters).toEqual({
        city: 'Sheikh Zayed',
        type: 'apartment',
        listing: 'SALE',
        priceMax: 7_000_000,
      });
    });

    it('drops leaked qualitative preferences of a new search', async () => {
      const h = createGraphHarness();
      const thread = randomUUID();
      await h.turn(thread, 'apartment with a garden view in New Cairo');
      const { state } = await h.turn(thread, 'apartment for sale in Maadi');
      expect(state.searchMode).toBe('new');
      expect(h.model.classifyCalls.at(-1)?.previousSemanticQuery).toBe(
        'garden view',
      );
      expect(state.semanticQuery).toBe('');

      const restated = await h.turn(
        thread,
        'apartment for rent with a garden view',
      );
      expect(restated.state.semanticQuery).toBe('garden view');
    });

    it('falls back to the first understanding as a new search when the forced attempt fails', async () => {
      const h = createGraphHarness();
      const thread = randomUUID();
      await h.turn(thread, 'apartment in New Cairo to buy');
      const classify = h.model.classify.bind(h.model);
      h.model.classify = async (input) => ({
        ...(await classify(input)),
        searchMode: 'refine',
      });
      const understand = h.model.understand.bind(h.model);
      h.model.understand = (input) =>
        input.forceNewSearch
          ? Promise.reject(new ProviderBusyError('busy'))
          : understand(input);

      const { state } = await h.turn(thread, 'apartment for rent');

      expect(state.searchMode).toBe('new');
      // The carried-over city is dropped; the restated type and listing stay.
      expect(state.filters).toEqual({ type: 'apartment', listing: 'RENT' });
      expect(h.warnings.join(' ')).toContain('forced new-search');
    });

    it('gives the previous filters and preferences to a refinement only', async () => {
      const h = createGraphHarness();
      const thread = randomUUID();
      await h.turn(thread, 'apartment with a garden view in New Cairo');
      const { state } = await h.turn(thread, 'something cheaper');

      expect(state.searchMode).toBe('refine');
      const call = h.model.filterCalls.at(-1);
      expect(call?.searchMode).toBe('refine');
      expect(call?.previousFilters).toMatchObject({ city: 'New Cairo' });
      expect(call?.previousSemanticQuery).toBe('garden view');
      expect(state.semanticQuery).toBe('garden view');
    });

    it('drops the old preferences when the router calls the request new', async () => {
      const h = createGraphHarness();
      const thread = randomUUID();
      await h.turn(thread, 'apartment with a garden view in New Cairo');
      const { state } = await h.turn(thread, 'apartment for rent');

      expect(state.searchMode).toBe('new');
      expect(state.semanticQuery).toBe('');
    });

    function routerAlwaysSaysRefine(h: ReturnType<typeof createGraphHarness>) {
      const classify = h.model.classify.bind(h.model);
      h.model.classify = async (input) => ({
        ...(await classify(input)),
        searchMode: 'refine',
      });
    }

    it('rent after a sale search is a new search, even when the router said refine', async () => {
      const h = createGraphHarness();
      routerAlwaysSaysRefine(h);
      const thread = randomUUID();
      await h.turn(
        thread,
        '3 bedroom apartment in New Cairo to buy under 7 million',
      );
      const before = h.model.filterCalls.length;

      const { state } = await h.turn(thread, 'apartment for rent');

      expect(h.model.filterCalls).toHaveLength(before + 2);
      expect(h.model.filterCalls.at(-2)?.searchMode).toBe('refine');
      expect(h.model.filterCalls.at(-1)).toMatchObject({
        searchMode: 'new',
        previousFilters: {},
      });
      expect(state.filters).toEqual({ type: 'apartment', listing: 'RENT' });
    });

    it('villa after an apartment search is a new search, even when the router said refine', async () => {
      const h = createGraphHarness();
      routerAlwaysSaysRefine(h);
      const thread = randomUUID();
      await h.turn(thread, '3 bedroom apartment in New Cairo under 7 million');
      const before = h.model.filterCalls.length;
      // First the refinement that wrongly swaps the type, then the clean re-extraction.
      h.model.filterQueue.push(
        {
          city: 'New Cairo',
          type: 'villa',
          bedroomsMin: 3,
          priceMax: 7_000_000,
        },
        { city: 'New Cairo', type: 'villa' },
      );

      const { state } = await h.turn(thread, 'villa in New Cairo');

      expect(h.model.filterCalls).toHaveLength(before + 2);
      expect(h.model.filterCalls.at(-1)).toMatchObject({
        searchMode: 'new',
        previousFilters: {},
      });
      expect(state.filters).toEqual({ city: 'New Cairo', type: 'villa' });
    });

    it('a complete request that restates the deal and names a type is new after a typeless search', async () => {
      const h = createGraphHarness();
      routerAlwaysSaysRefine(h);
      const thread = randomUUID();
      await h.turn(thread, 'Show me properties for sale in Sheikh Zayed.');
      const before = h.model.filterCalls.length;

      const { state } = await h.turn(
        thread,
        '3 bedroom apartment for sale under 12 million EGP.',
      );

      // No third LLM call: the mode is corrected in code, the guard drops the city.
      expect(h.model.filterCalls).toHaveLength(before + 1);
      expect(state.searchMode).toBe('new');
      expect(state.filters).toEqual({
        type: 'apartment',
        listing: 'SALE',
        bedroomsMin: 3,
        priceMax: 12_000_000,
      });
    });

    it('"only apartments" after a typeless search stays a refinement', async () => {
      const h = createGraphHarness();
      routerAlwaysSaysRefine(h);
      const thread = randomUUID();
      await h.turn(thread, 'Show me properties for sale in Sheikh Zayed.');

      const { state } = await h.turn(thread, 'only apartments');

      expect(state.searchMode).toBe('refine');
      expect(state.filters).toMatchObject({
        city: 'Sheikh Zayed',
        listing: 'SALE',
        type: 'apartment',
      });
    });

    it('in Zayed instead keeps priceMax and bedroomsMin', async () => {
      const h = createGraphHarness();
      const thread = randomUUID();
      await h.turn(thread, '3 bedroom apartment in New Cairo under 7 million');
      const before = h.model.filterCalls.length;

      const { state } = await h.turn(thread, 'in Sheikh Zayed instead');

      expect(state.searchMode).toBe('refine');
      expect(h.model.filterCalls).toHaveLength(before + 1);
      expect(state.filters).toMatchObject({
        city: 'Sheikh Zayed',
        type: 'apartment',
        bedroomsMin: 3,
        priceMax: 7_000_000,
      });
    });

    it('keeps the refined filters when the router said refine and the identity is unchanged', async () => {
      const h = createGraphHarness();
      const thread = randomUUID();
      await h.turn(thread, '3 bedroom apartment in New Cairo under 7 million');
      const before = h.model.filterCalls.length;

      const { state } = await h.turn(thread, 'something cheaper');

      expect(h.model.filterCalls).toHaveLength(before + 1);
      expect(state.filters).toMatchObject({
        city: 'New Cairo',
        bedroomsMin: 3,
        priceMax: 5_000_000,
      });
    });

    it('keeps the search mode through turns that are not searches', async () => {
      const h = createGraphHarness();
      const thread = randomUUID();
      await h.turn(thread, 'apartment in New Cairo');
      await h.turn(thread, 'something cheaper');
      const { state } = await h.turn(thread, 'thanks');
      expect(state.intent).toBe('smalltalk');
      expect(state.searchMode).toBe('refine');
    });

    it('explains both modes to the router', () => {
      const [system] = understandMessages({
        messages: [{ role: 'user', text: 'villa in Zayed' }],
        candidates: [],
        bookingInProgress: false,
        previousFilters: {},
        previousSemanticQuery: '',
        today: '2026-10-12',
        facets: { cities: [], compounds: [] },
      });
      expect(system?.content).toContain('searchMode');
      expect(system?.content).toContain('refine');
      expect(system?.content).toContain('3ayez villa fe Zayed');
    });
  });

  describe('changesSearchIdentity', () => {
    it('is true only when both searches set a different listing or type', () => {
      expect(
        changesSearchIdentity({ listing: 'RENT' }, { listing: 'SALE' }),
      ).toBe(true);
      expect(
        changesSearchIdentity({ type: 'apartment' }, { type: 'villa' }),
      ).toBe(true);
      expect(
        changesSearchIdentity({ type: 'villa' }, { type: 'Villa' as never }),
      ).toBe(false);
      expect(changesSearchIdentity({ type: 'villa' }, {})).toBe(false);
      expect(changesSearchIdentity({}, { listing: 'SALE' })).toBe(false);
    });

    it('treats a changed location alone as a refinement', () => {
      expect(
        changesSearchIdentity({ city: 'New Cairo' }, { city: 'Sheikh Zayed' }),
      ).toBe(false);
      expect(
        changesSearchIdentity({ compound: 'Laurel' }, { compound: 'Mivida' }),
      ).toBe(false);
      expect(
        changesSearchIdentity({ district: 'Fifth' }, { district: 'Third' }),
      ).toBe(false);
      expect(
        changesSearchIdentity({ priceMax: 1 }, { priceMax: 2, bedroomsMin: 3 }),
      ).toBe(false);
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
      expect(trimNode({ messages: messages.slice(0, 20) } as never)).toEqual(
        {},
      );
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

  describe('LLM calls per turn', () => {
    type H = ReturnType<typeof createGraphHarness>;
    const llmCalls = (h: H) =>
      h.model.understandCalls.length +
      h.model.answerCalls.length +
      h.model.detailsCalls.length +
      h.model.bookingCalls.length;

    async function calls(h: H, thread: string, message: string) {
      const before = llmCalls(h);
      await h.turn(thread, message);
      return llmCalls(h) - before;
    }

    it('a search makes two: the combined understanding, then the answer', async () => {
      const h = createGraphHarness();
      expect(await calls(h, randomUUID(), 'apartments in New Cairo')).toBe(2);
      expect(h.model.understandCalls).toHaveLength(1);
      expect(h.model.answerCalls).toHaveLength(1);
    });

    it('a refinement makes two as well', async () => {
      const h = createGraphHarness();
      const thread = randomUUID();
      await h.turn(thread, 'apartments in New Cairo');
      expect(await calls(h, thread, 'something cheaper')).toBe(2);
    });

    it('details and booking turns make two, smalltalk and refusals one', async () => {
      const h = createGraphHarness();
      const thread = randomUUID();
      await h.turn(thread, 'apartments in New Cairo');
      expect(await calls(h, thread, 'tell me more about the second one')).toBe(
        2,
      );
      expect(await calls(h, thread, 'book the first one')).toBe(2);
      expect(await calls(h, thread, 'thanks')).toBe(1);
      expect(await calls(h, thread, 'what is the weather today?')).toBe(1);
    });

    it('only the identity safety net adds a call to a search turn', async () => {
      const h = createGraphHarness();
      const thread = randomUUID();
      await h.turn(thread, 'apartment in New Cairo to buy');
      const classify = h.model.classify.bind(h.model);
      h.model.classify = async (input) => ({
        ...(await classify(input)),
        searchMode: 'refine',
      });
      expect(await calls(h, thread, 'apartment for rent')).toBe(3);
    });

    it('never retries a call that failed because the provider is busy', async () => {
      const h = createGraphHarness();
      h.model.classify = () => Promise.reject(new ProviderBusyError('busy'));
      await expect(h.turn(randomUUID(), 'apartments')).rejects.toBeInstanceOf(
        ProviderBusyError,
      );
      expect(h.model.understandCalls).toHaveLength(1);
    });

    it('retries once when the output is unusable, then fails the turn', async () => {
      const h = createGraphHarness();
      h.model.classify = () => Promise.reject(new Error('no valid output'));
      await expect(h.turn(randomUUID(), 'apartments')).rejects.toThrow(
        'no valid output',
      );
      expect(h.model.understandCalls).toHaveLength(2);
    });
  });

  describe('ordinals read from the visitor message', () => {
    type H = ReturnType<typeof createGraphHarness>;

    /** The model understood the intent but left the listing reference empty. */
    function modelLeavesRefEmpty(h: H, intent: 'details' | 'book') {
      h.model.classify = () =>
        Promise.resolve({
          intent,
          searchMode: 'refine',
          semanticQuery: '',
          propertyRef: undefined,
        });
    }

    async function searched() {
      const h = createGraphHarness();
      const thread = randomUUID();
      await h.turn(thread, 'apartments in New Cairo');
      return { h, thread };
    }

    it.each([
      ['tell me more about the second one', 'beta-apartment'],
      ['payment plan of the first one', 'alpha-apartment'],
      ['details of the last one', 'gamma-apartment'],
      ['details of number 3', 'gamma-apartment'],
      ['تفاصيل التاني', 'beta-apartment'],
      ['قولي أكتر عن الأولى', 'alpha-apartment'],
      ['عايز اعرف عن التالتة', 'gamma-apartment'],
      ['الأخيرة؟', 'gamma-apartment'],
    ])(
      'details: "%s" opens %s even when the model gave no reference',
      async (message, slug) => {
        const { h, thread } = await searched();
        modelLeavesRefEmpty(h, 'details');
        const { state } = await h.turn(thread, message);
        expect(state.propertyRef).toBe(slug);
        expect(h.model.detailsCalls.at(-1)?.card.slug).toBe(slug);
      },
    );

    it('booking: "the second one" is resolved without the model', async () => {
      const { h, thread } = await searched();
      modelLeavesRefEmpty(h, 'book');
      h.model.bookingQueue = [{}];
      const { state } = await h.turn(thread, 'book the second one');
      expect(state.bookingDraft.propertySlug).toBe('beta-apartment');
    });

    it('a reference of the model that resolves wins over the message words', async () => {
      const { h, thread } = await searched();
      h.model.classify = () =>
        Promise.resolve({
          intent: 'details',
          searchMode: 'refine',
          semanticQuery: '',
          propertyRef: 'alpha-apartment',
        });
      const { state } = await h.turn(thread, 'tell me about the third one');
      expect(state.propertyRef).toBe('alpha-apartment');
    });

    it.each([
      'book it for the 2nd of November',
      'my last name is Hassan',
      'what is the first installment?',
      'يوم اول الشهر',
      'عايز ميعاد تاني',
    ])('"%s" does not pick a listing', async (message) => {
      const { h, thread } = await searched();
      modelLeavesRefEmpty(h, 'details');
      const { state } = await h.turn(thread, message);
      expect(state.propertyRef).toBeNull();
    });

    it('a booking in progress never switches property because of ordinal words', async () => {
      const { h, thread } = await searched();
      modelLeavesRefEmpty(h, 'book');
      h.model.bookingQueue = [{}];
      await h.turn(thread, 'book the second one');
      h.model.bookingQueue = [{}];
      const { state } = await h.turn(thread, 'the third one is also nice');
      expect(state.bookingDraft.propertySlug).toBe('beta-apartment');
      expect(state.propertyRef).toBeNull();
    });

    it('the reference of the model is the fallback when the message has no ordinal', async () => {
      const { h, thread } = await searched();
      h.model.classify = () =>
        Promise.resolve({
          intent: 'details',
          searchMode: 'refine',
          semanticQuery: '',
          propertyRef: 'beta-apartment',
        });
      const { state } = await h.turn(thread, 'tell me more about that one');
      expect(state.propertyRef).toBe('beta-apartment');
      expect(h.model.detailsCalls.at(-1)?.card.slug).toBe('beta-apartment');
    });

    it('still reads the list of the search after a details turn showed one card', async () => {
      const { h, thread } = await searched();
      await h.turn(thread, 'tell me more about the first one');
      modelLeavesRefEmpty(h, 'details');
      const { state } = await h.turn(thread, 'and the third one?');
      expect(state.propertyRef).toBe('gamma-apartment');
    });

    it('an ordinal beyond the list shown resolves to nothing', async () => {
      const { h, thread } = await searched();
      modelLeavesRefEmpty(h, 'details');
      const { text } = await h.turn(thread, 'details of the fifth one');
      expect(text).toContain('Which listing');
    });
  });
});
