import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ZodError } from 'zod';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
} from 'vitest';
import {
  BookingCancelledError,
  BookingsService,
} from '../bookings/bookings.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ProviderBusyError } from '../llm/provider-errors.js';
import { createChatIntegrationApp } from '../testing/chat-integration-app.js';
import { FakeAgentModel } from '../testing/fake-agent-model.js';
import { FakeEmbeddings } from '../testing/fake-embeddings.js';
import {
  CSRF_HEADERS,
  TEST_ADMIN_TOKEN,
  resetDatabase,
} from '../testing/integration-app.js';
import { listingMarkdown } from '../testing/listing-fixtures.js';
import { businessToday } from './booking-validation.js';
import type { ChatEvent } from './chat-events.js';
import { CHAT_COOKIE } from './chat-thread-cookie.js';
import { ChatService, type ChatHistoryMessage } from './chat.service.js';

const databaseUrl = inject('integrationDatabaseUrl');

type Fields = Record<string, string | number | null>;

const LISTINGS: Record<string, { title: string; fields: Fields }> = {
  'laurel-apartment': {
    title: 'Three-bedroom apartment at Laurel Heights',
    fields: {
      type: 'apartment',
      listing: 'SALE',
      price: 6_000_000,
      bedrooms: 3,
      bathrooms: 2,
      areaM2: 180,
      city: 'New Cairo',
      compound: 'Laurel Heights',
    },
  },
  'laurel-villa': {
    title: 'Corner villa at Laurel Hills',
    fields: {
      type: 'villa',
      listing: 'SALE',
      price: 28_500_000,
      bedrooms: 4,
      bathrooms: 5,
      areaM2: 420,
      city: 'New Cairo',
      compound: 'Laurel Hills',
    },
  },
  'zamalek-flat': {
    title: 'Furnished flat in Zamalek',
    fields: {
      type: 'apartment',
      listing: 'RENT',
      price: 55_000,
      bedrooms: 2,
      bathrooms: 2,
      areaM2: 140,
      city: 'Zamalek',
    },
  },
  'small-new-cairo-flat': {
    title: 'Two-bedroom flat in New Cairo',
    fields: {
      type: 'apartment',
      listing: 'SALE',
      price: 3_500_000,
      bedrooms: 2,
      bathrooms: 1,
      areaM2: 110,
      city: 'New Cairo',
    },
  },
};

interface ChatResponse {
  status: number;
  events: ChatEvent[];
  body: unknown;
}

function parseSse(text: string): ChatEvent[] {
  return text
    .split('\n\n')
    .map((block) => block.split('\n').find((line) => line.startsWith('data: ')))
    .filter((line): line is string => line !== undefined)
    .map((line) => JSON.parse(line.slice('data: '.length)) as ChatEvent);
}

function daysFromToday(days: number): string {
  const date = new Date(
    `${businessToday(new Date(), 'Africa/Cairo')}T00:00:00Z`,
  );
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

describe.skipIf(!databaseUrl)('chat API (integration)', () => {
  const embeddings = new FakeEmbeddings();
  const model = new FakeAgentModel();
  let app: INestApplication;
  let prisma: PrismaService;
  let apiUrl: string;

  beforeAll(async () => {
    const created = await createChatIntegrationApp(databaseUrl as string, {
      embeddings,
      agentModel: model,
      env: { CHAT_THROTTLE_LIMIT: '1000', THROTTLE_LIMIT: '100000' },
    });
    app = created.app;
    prisma = created.prisma;
    apiUrl = created.apiUrl;
  });

  afterAll(async () => {
    await app?.close();
  });

  async function ingest(slug: string, title: string, fields: Fields) {
    const form = new FormData();
    form.append(
      'files',
      new Blob([listingMarkdown({ slug, title, fields })]),
      `${slug}.md`,
    );
    const response = await fetch(`${apiUrl}/admin/documents`, {
      method: 'POST',
      headers: { 'x-admin-token': TEST_ADMIN_TOKEN, ...CSRF_HEADERS },
      body: form,
    });
    const [result] = (await response.json()) as { outcome: string }[];
    expect(result?.outcome).toBe('created');
  }

  beforeEach(async () => {
    model.configured = true;
    model.filterQueue = [];
    model.answerSuffix = '';
    model.classifyCalls.length = 0;
    model.understandCalls.length = 0;
    Reflect.deleteProperty(model, 'classify');
    await resetDatabase(prisma);
    for (const [slug, { title, fields }] of Object.entries(LISTINGS)) {
      await ingest(slug, title, fields);
    }
    await ingest('pending-listing', 'Listing still being indexed', {
      city: 'New Cairo',
    });
    await prisma.document.updateMany({
      where: { property: { slug: 'pending-listing' } },
      data: { status: 'PENDING' },
    });
  });

  /** Headers of a visitor whose `chat_thread` cookie holds `threadId`. */
  function visitor(threadId: string): Record<string, string> {
    return { cookie: `${CHAT_COOKIE}=${threadId}`, ...CSRF_HEADERS };
  }

  function getHistory(threadId: string): Promise<Response> {
    return fetch(`${apiUrl}/chat/history`, { headers: visitor(threadId) });
  }

  async function chat(
    threadId: string,
    message: string,
    baseUrl = apiUrl,
    headers: Record<string, string> = {},
  ): Promise<ChatResponse> {
    const response = await fetch(`${baseUrl}/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...visitor(threadId),
        ...headers,
      },
      body: JSON.stringify({ message }),
    });
    const isStream = response.headers
      .get('content-type')
      ?.startsWith('text/event-stream');
    if (isStream) {
      return {
        status: response.status,
        events: parseSse(await response.text()),
        body: null,
      };
    }
    return {
      status: response.status,
      events: [],
      body: await response.json(),
    };
  }

  function eventOf<T extends ChatEvent['type']>(
    events: ChatEvent[],
    type: T,
  ): Extract<ChatEvent, { type: T }> {
    const event = events.find((e) => e.type === type);
    expect(event, `expected a "${type}" event`).toBeDefined();
    return event as Extract<ChatEvent, { type: T }>;
  }

  it('streams a search: only listings matching the filters, then tokens, final and done', async () => {
    const threadId = randomUUID();
    const { status, events } = await chat(
      threadId,
      '3 bedroom apartment in New Cairo',
    );

    expect(status).toBe(200);
    expect(events.map((e) => e.type)).toEqual([
      'status',
      'status',
      'filters',
      'properties',
      'token',
      'token',
      'final',
      'done',
    ]);
    expect(eventOf(events, 'filters')).toMatchObject({
      filters: { city: 'New Cairo', type: 'apartment', bedroomsMin: 3 },
    });
    expect(
      eventOf(events, 'properties').items.map((item) => item.slug),
    ).toEqual(['laurel-apartment']);
    const final = eventOf(events, 'final');
    expect(final.intent).toBe('search');
    expect(final.citedSlugs).toEqual(['laurel-apartment']);
    expect(final.text).toContain('[laurel-apartment]');
  });

  it('never returns listings of documents that are not INDEXED, and ranks by meaning within the filters', async () => {
    model.classify = () =>
      Promise.resolve({
        intent: 'search',
        searchMode: 'refine',
        semanticQuery: 'quiet street with a garden',
        propertyRef: undefined,
      });
    model.filterQueue = [{ city: 'New Cairo' }];
    const { events } = await chat(randomUUID(), 'quiet place in New Cairo');

    const slugs = eventOf(events, 'properties').items.map((i) => i.slug);
    expect([...slugs].sort()).toEqual([
      'laurel-apartment',
      'laurel-villa',
      'small-new-cairo-flat',
    ]);
    expect(slugs).not.toContain('pending-listing');
    expect(slugs).not.toContain('zamalek-flat');
    expect(model.answerCalls.at(-1)?.listings).toHaveLength(3);
  });

  it('refines the previous filters on the next message of the same thread', async () => {
    const threadId = randomUUID();
    await chat(threadId, 'apartment in New Cairo');
    const { events } = await chat(threadId, 'something cheaper');

    expect(eventOf(events, 'filters').filters).toMatchObject({
      city: 'New Cairo',
      type: 'apartment',
      priceMax: 5_000_000,
    });
    expect(eventOf(events, 'properties').items.map((i) => i.slug)).toEqual([
      'small-new-cairo-flat',
    ]);
  });

  it('books a viewing across three messages and creates exactly one booking', async () => {
    const threadId = randomUUID();
    await chat(threadId, '3 bedroom apartment in New Cairo');

    const first = await chat(threadId, 'I want to book the first one');
    expect(eventOf(first.events, 'final').text).toContain('your full name');

    const second = await chat(threadId, 'my name is Test User, 01001234567');
    expect(eventOf(second.events, 'final').text).toContain(
      'preferred viewing date',
    );
    expect(await prisma.booking.count()).toBe(0);

    const date = daysFromToday(7);
    const third = await chat(threadId, `Saturday works: ${date} 17:00`);

    const bookingEvent = eventOf(third.events, 'booking').booking;
    expect(bookingEvent).toMatchObject({
      propertySlug: 'laurel-apartment',
      name: 'Test User',
      phone: '01001234567',
      preferredDate: date,
      preferredTime: '17:00',
      status: 'CONFIRMED',
    });
    expect(eventOf(third.events, 'final').text).toContain(
      bookingEvent.reference,
    );

    const rows = await prisma.booking.findMany({
      include: { property: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'CONFIRMED',
      threadId,
      name: 'Test User',
      phone: '01001234567',
      preferredTime: '17:00',
    });
    expect(rows[0]?.property.slug).toBe('laurel-apartment');
    // A DATE column: exactly the requested day, whatever the server time zone.
    expect(rows[0]?.preferredDate.toISOString()).toBe(`${date}T00:00:00.000Z`);

    const history = await getHistory(threadId);
    const { messages } = (await history.json()) as {
      messages: ChatHistoryMessage[];
    };
    expect(messages.at(-1)?.booking?.reference).toBe(bookingEvent.reference);
    // The page never receives the full number back.
    expect(messages.at(-1)?.booking?.phone).toBe('010****4567');
    expect(JSON.stringify(messages)).not.toContain('01001234567');
  });

  it('is idempotent per thread, property and date', async () => {
    const bookings = app.get(BookingsService);
    const property = await prisma.property.findUniqueOrThrow({
      where: { slug: 'laurel-apartment' },
    });
    const input = {
      threadId: randomUUID(),
      propertySlug: 'laurel-apartment',
      name: 'Test User',
      phone: '01001234567',
      preferredDate: daysFromToday(10),
    };

    const [a, b] = await Promise.all([
      bookings.create(input),
      bookings.create(input),
    ]);
    const c = await bookings.create(input);

    expect(a.booking.id).toBe(b.booking.id);
    expect(c.booking.id).toBe(a.booking.id);
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
    expect(c.created).toBe(false);
    expect(await prisma.booking.count()).toBe(1);

    await bookings.create({ ...input, preferredDate: daysFromToday(11) });
    await bookings.create({ ...input, threadId: randomUUID() });
    expect(await prisma.booking.count()).toBe(3);
    expect(
      await prisma.booking.count({ where: { propertyId: property.id } }),
    ).toBe(3);
  });

  it('stores a missing time as null and shows it as any time', async () => {
    const { booking } = await app.get(BookingsService).create({
      threadId: randomUUID(),
      propertySlug: 'laurel-apartment',
      name: 'Test User',
      phone: '01001234567',
      preferredDate: daysFromToday(10),
    });
    expect(booking.preferredTime).toBeNull();
    const row = await prisma.booking.findUniqueOrThrow({
      where: { id: booking.id },
    });
    expect(row.preferredTime).toBeNull();
  });

  it('updates the existing booking when the same day is booked at another time', async () => {
    const bookings = app.get(BookingsService);
    const input = {
      threadId: randomUUID(),
      propertySlug: 'laurel-apartment',
      name: 'Test User',
      phone: '01001234567',
      preferredDate: daysFromToday(10),
    };
    const first = await bookings.create({ ...input, preferredTime: '10:00' });
    expect(first.created).toBe(true);

    const moved = await bookings.create({ ...input, preferredTime: '17:30' });
    expect(moved.created).toBe(false);
    expect(moved.booking.id).toBe(first.booking.id);
    expect(moved.booking.preferredTime).toBe('17:30');

    const anyTime = await bookings.create({ ...input, preferredTime: null });
    expect(anyTime.booking.id).toBe(first.booking.id);
    expect(anyTime.booking.preferredTime).toBeNull();

    const same = await bookings.create({ ...input });
    expect(same.booking.id).toBe(first.booking.id);
    expect(await prisma.booking.count()).toBe(1);

    // Another day is another booking, even at the same time.
    await bookings.create({
      ...input,
      preferredDate: daysFromToday(11),
      preferredTime: '17:30',
    });
    expect(await prisma.booking.count()).toBe(2);
  });

  it('normalises the time, so "9:00" and "09:00" are the same booking', async () => {
    const bookings = app.get(BookingsService);
    const input = {
      threadId: randomUUID(),
      propertySlug: 'laurel-apartment',
      name: 'Test User',
      phone: '01001234567',
      preferredDate: daysFromToday(10),
    };
    const first = await bookings.create({ ...input, preferredTime: '9:00' });
    expect(first.created).toBe(true);
    expect(first.booking.preferredTime).toBe('09:00');

    const again = await bookings.create({ ...input, preferredTime: '09:00' });
    expect(again.created).toBe(false);
    expect(again.booking.id).toBe(first.booking.id);
    expect(await prisma.booking.count()).toBe(1);
    const row = await prisma.booking.findUniqueOrThrow({
      where: { id: first.booking.id },
    });
    expect(row.preferredTime).toBe('09:00');
  });

  it.each([
    ['a time that does not exist', { preferredTime: '25:00' }],
    ['a time with words', { preferredTime: '9am' }],
    ['an empty time', { preferredTime: '' }],
    ['a date that does not exist', { preferredDate: '2026-02-30' }],
    ['a date in another format', { preferredDate: '19/10/2026' }],
  ])('refuses %s before touching the database', async (_name, bad) => {
    await expect(
      app.get(BookingsService).create({
        threadId: randomUUID(),
        propertySlug: 'laurel-apartment',
        name: 'Test User',
        phone: '01001234567',
        preferredDate: daysFromToday(10),
        ...bad,
      }),
    ).rejects.toBeInstanceOf(ZodError);
    expect(await prisma.booking.count()).toBe(0);
  });

  it('updates name and phone when the same booking is repeated while CONFIRMED', async () => {
    const bookings = app.get(BookingsService);
    const input = {
      threadId: randomUUID(),
      propertySlug: 'laurel-apartment',
      name: 'Test User',
      phone: '01001234567',
      preferredDate: daysFromToday(10),
    };
    const { booking } = await bookings.create(input);

    const again = await bookings.create({
      ...input,
      name: 'Corrected Name',
      phone: '01112345678',
    });
    expect(again.created).toBe(false);
    expect(again.booking.id).toBe(booking.id);
    expect(again.booking).toMatchObject({
      name: 'Corrected Name',
      phone: '01112345678',
      status: 'CONFIRMED',
    });
    const row = await prisma.booking.findUniqueOrThrow({
      where: { id: booking.id },
    });
    expect(row).toMatchObject({
      name: 'Corrected Name',
      phone: '01112345678',
    });
    expect(await prisma.booking.count()).toBe(1);
  });

  it('never resurrects a cancelled booking', async () => {
    const bookings = app.get(BookingsService);
    const input = {
      threadId: randomUUID(),
      propertySlug: 'laurel-apartment',
      name: 'Test User',
      phone: '01001234567',
      preferredDate: daysFromToday(10),
    };
    const { booking } = await bookings.create(input);
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: 'CANCELLED' },
    });

    await expect(
      bookings.create({ ...input, name: 'Someone Else' }),
    ).rejects.toBeInstanceOf(BookingCancelledError);
    const row = await prisma.booking.findUniqueOrThrow({
      where: { id: booking.id },
    });
    expect(row).toMatchObject({ status: 'CANCELLED', name: 'Test User' });
    expect(await prisma.booking.count()).toBe(1);
  });

  it('refuses to book a listing that is not INDEXED', async () => {
    await expect(
      app.get(BookingsService).create({
        threadId: randomUUID(),
        propertySlug: 'pending-listing',
        name: 'Test User',
        phone: '01001234567',
        preferredDate: daysFromToday(5),
      }),
    ).rejects.toThrow('not available for booking');
  });

  it('refuses off-topic requests politely', async () => {
    const { events } = await chat(randomUUID(), 'what is the weather today?');
    const final = eventOf(events, 'final');
    expect(final.intent).toBe('off_topic');
    expect(final.text).toContain('real estate');
    expect(events.some((e) => e.type === 'properties')).toBe(false);
  });

  it('reports a failing model as an error event followed by done', async () => {
    model.classify = () => Promise.reject(new Error('provider down'));
    const { status, events } = await chat(randomUUID(), 'apartment');
    expect(status).toBe(200);
    expect(events.map((e) => e.type)).toEqual(['status', 'error', 'done']);
    expect(eventOf(events, 'error').message).not.toContain('provider down');
  });

  it('reports a busy provider as a distinct error event the web can recognise', async () => {
    model.classify = () => Promise.reject(new ProviderBusyError('busy'));
    const { events } = await chat(randomUUID(), 'apartment');
    expect(events.map((e) => e.type)).toEqual(['status', 'error', 'done']);
    expect(eventOf(events, 'error')).toMatchObject({
      code: 'provider_busy',
      message: 'The AI provider is busy right now. Please try again in a minute.',
    });
  });

  it('rolls a failed turn back: history unchanged, and a retry stores one human message', async () => {
    const threadId = randomUUID();
    await chat(threadId, 'apartment in New Cairo');
    const historyOf = async () =>
      (await (await getHistory(threadId)).json()) as {
        messages: ChatHistoryMessage[];
      };
    const before = await historyOf();

    model.classify = () => Promise.reject(new Error('provider down'));
    const failed = await chat(threadId, 'something cheaper');
    expect(failed.events.map((e) => e.type)).toEqual([
      'status',
      'error',
      'done',
    ]);
    expect(await historyOf()).toEqual(before);

    Reflect.deleteProperty(model, 'classify');
    const retried = await chat(threadId, 'something cheaper');
    expect(eventOf(retried.events, 'final').intent).toBe('search');
    const { messages } = await historyOf();
    expect(messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(messages.filter((m) => m.text === 'something cheaper')).toHaveLength(
      1,
    );
  });

  it('keeps the confirmation and the booking row when the client aborts after the booking', async () => {
    const threadId = randomUUID();
    await chat(threadId, '3 bedroom apartment in New Cairo');

    const service = app.get(ChatService);
    const abort = new AbortController();
    const date = daysFromToday(7);
    const types: string[] = [];
    const stream = service.run(
      threadId,
      `book the first one, my name is Test User, 01001234567 ${date} 17:00`,
      abort.signal,
    );
    for await (const event of stream) {
      types.push(event.type);
      if (event.type === 'booking') abort.abort();
    }

    expect(types).not.toContain('error');
    expect(await prisma.booking.count()).toBe(1);
    const history = await service.history(threadId);
    expect(history.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    const confirmation = history.at(-1);
    expect(confirmation?.booking).toMatchObject({
      propertySlug: 'laurel-apartment',
      preferredDate: date,
      preferredTime: '17:00',
    });
    expect(confirmation?.booking?.reference).toBe(
      (await prisma.booking.findFirstOrThrow()).id.slice(-8).toUpperCase(),
    );
    expect(confirmation?.text).toContain('Your viewing is confirmed');
  });

  it('forgets a conversation whose first turn failed', async () => {
    const threadId = randomUUID();
    model.classify = () => Promise.reject(new Error('provider down'));
    await chat(threadId, 'apartment');
    const response = await getHistory(threadId);
    expect(await response.json()).toEqual({ messages: [] });
  });

});
