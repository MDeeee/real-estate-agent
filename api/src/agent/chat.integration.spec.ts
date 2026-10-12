import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
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
import { createChatIntegrationApp } from '../testing/chat-integration-app.js';
import { FakeAgentModel } from '../testing/fake-agent-model.js';
import { FakeEmbeddings } from '../testing/fake-embeddings.js';
import { TEST_ADMIN_TOKEN, resetDatabase } from '../testing/integration-app.js';
import { listingMarkdown } from '../testing/listing-fixtures.js';
import { cairoToday } from './booking-validation.js';
import type { ChatEvent } from './chat-events.js';
import type { ChatHistoryMessage } from './chat.service.js';

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
  const date = new Date(`${cairoToday(new Date())}T00:00:00Z`);
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
      env: { CHAT_THROTTLE_LIMIT: '1000' },
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
      headers: { 'x-admin-token': TEST_ADMIN_TOKEN },
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

  async function chat(
    threadId: string,
    message: string,
    baseUrl = apiUrl,
    headers: Record<string, string> = {},
  ): Promise<ChatResponse> {
    const response = await fetch(`${baseUrl}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ threadId, message }),
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
        language: 'en',
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
    const third = await chat(threadId, `Saturday works: ${date}`);

    const bookingEvent = eventOf(third.events, 'booking').booking;
    expect(bookingEvent).toMatchObject({
      propertySlug: 'laurel-apartment',
      name: 'Test User',
      phone: '01001234567',
      preferredDate: date,
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
    });
    expect(rows[0]?.property.slug).toBe('laurel-apartment');
    expect(rows[0]?.preferredDate.toISOString().slice(0, 10)).toBe(date);

    const history = await fetch(`${apiUrl}/chat/${threadId}`);
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

  it('returns the message history of a thread, with cards and the search used', async () => {
    const threadId = randomUUID();
    await chat(threadId, '3 bedroom apartment in New Cairo');
    await chat(threadId, 'hello');

    const response = await fetch(`${apiUrl}/chat/${threadId}`);
    expect(response.status).toBe(200);
    const { messages } = (await response.json()) as {
      messages: ChatHistoryMessage[];
    };
    expect(messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(messages[0]?.text).toBe('3 bedroom apartment in New Cairo');
    expect(messages[1]?.properties?.map((p) => p.slug)).toEqual([
      'laurel-apartment',
    ]);
    expect(messages[1]?.search?.filters).toMatchObject({ city: 'New Cairo' });
    expect(messages[3]?.properties).toBeUndefined();
  });

  it('rolls a failed turn back: history unchanged, and a retry stores one human message', async () => {
    const threadId = randomUUID();
    await chat(threadId, 'apartment in New Cairo');
    const historyOf = async () =>
      (await (await fetch(`${apiUrl}/chat/${threadId}`)).json()) as {
        messages: ChatHistoryMessage[];
      };
    const before = await historyOf();

    model.classify = () => Promise.reject(new Error('provider down'));
    const failed = await chat(threadId, 'something cheaper');
    expect(failed.events.map((e) => e.type)).toEqual(['status', 'error', 'done']);
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

  it('forgets a conversation whose first turn failed', async () => {
    const threadId = randomUUID();
    model.classify = () => Promise.reject(new Error('provider down'));
    await chat(threadId, 'apartment');
    const response = await fetch(`${apiUrl}/chat/${threadId}`);
    expect(await response.json()).toEqual({ messages: [] });
  });

  it('answers 409 with a neutral message while a reply is in progress', async () => {
    const threadId = randomUUID();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    model.classify = async () => {
      entered();
      await gate;
      return {
        intent: 'smalltalk',
        language: 'en',
        semanticQuery: '',
        propertyRef: undefined,
      };
    };

    const first = chat(threadId, 'hello');
    await started;
    const second = await chat(threadId, 'hello again');
    release();
    await first;

    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({
      message: expect.stringContaining('still being handled'),
    });
    expect(JSON.stringify(second.body)).not.toContain('already in progress');
  });

  it('returns an empty history for an unknown thread', async () => {
    const response = await fetch(`${apiUrl}/chat/${randomUUID()}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ messages: [] });
  });

  it('rejects an invalid thread id and invalid messages with 400', async () => {
    expect((await chat('not-a-uuid', 'hi')).status).toBe(400);
    expect((await chat(randomUUID(), '')).status).toBe(400);
    expect((await chat(randomUUID(), 'x'.repeat(1001))).status).toBe(400);
    expect((await fetch(`${apiUrl}/chat/not-a-uuid`)).status).toBe(400);
  });

  it('answers 503 when the model is not configured', async () => {
    model.configured = false;
    const { status, body } = await chat(randomUUID(), 'hi');
    expect(status).toBe(503);
    expect(body).toMatchObject({
      message: 'The AI assistant is not configured',
    });
  });
});

describe.skipIf(!databaseUrl)('chat API without an LLM (integration)', () => {
  let created: Awaited<ReturnType<typeof createChatIntegrationApp>>;

  beforeAll(async () => {
    created = await createChatIntegrationApp(databaseUrl as string, {
      embeddings: new FakeEmbeddings(),
    });
  });

  afterAll(async () => {
    await created?.app.close();
  });

  it('boots, serves history and answers 503 to chat', async () => {
    const threadId = randomUUID();
    const response = await fetch(`${created.apiUrl}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ threadId, message: 'hello' }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      message: 'The AI assistant is not configured',
    });
    expect((await fetch(`${created.apiUrl}/chat/${threadId}`)).status).toBe(
      200,
    );
    expect((await fetch(`${created.apiUrl}/properties`)).status).toBe(200);
  });
});

describe.skipIf(!databaseUrl)('chat throttling (integration)', () => {
  const INTERNAL_KEY = 'k'.repeat(32);
  let created: Awaited<ReturnType<typeof createChatIntegrationApp>>;

  beforeAll(async () => {
    created = await createChatIntegrationApp(databaseUrl as string, {
      embeddings: new FakeEmbeddings(),
      agentModel: new FakeAgentModel(),
      env: { CHAT_THROTTLE_LIMIT: '2', INTERNAL_API_KEY: INTERNAL_KEY },
    });
  });

  afterAll(async () => {
    await created?.app.close();
  });

  async function post(clientIp: string): Promise<number> {
    const response = await fetch(`${created.apiUrl}/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-key': INTERNAL_KEY,
        'x-client-ip': clientIp,
      },
      body: JSON.stringify({ threadId: randomUUID(), message: 'hello' }),
    });
    await response.text();
    return response.status;
  }

  it('limits chat requests per visitor IP, not per web server', async () => {
    expect(await post('203.0.113.7')).toBe(200);
    expect(await post('203.0.113.7')).toBe(200);
    expect(await post('203.0.113.7')).toBe(429);
    expect(await post('203.0.113.8')).toBe(200);
  });

  it('answers a per-IP 429 with a friendly message and a Retry-After header', async () => {
    const ip = '203.0.113.50';
    await post(ip);
    await post(ip);
    const response = await fetch(`${created.apiUrl}/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-key': INTERNAL_KEY,
        'x-client-ip': ip,
      },
      body: JSON.stringify({ threadId: randomUUID(), message: 'hello' }),
    });
    expect(response.status).toBe(429);
    const retryAfter = Number(response.headers.get('retry-after'));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    const body = (await response.json()) as { message: string };
    expect(body.message).toBe(
      'Too many requests. Please wait a moment and try again.',
    );
    expect(JSON.stringify(body)).not.toContain('ThrottlerException');
  });

  it('does not count history reads against the chat budget', async () => {
    for (let i = 0; i < 5; i += 1) {
      const response = await fetch(`${created.apiUrl}/chat/${randomUUID()}`, {
        headers: {
          'x-internal-key': INTERNAL_KEY,
          'x-client-ip': '203.0.113.99',
        },
      });
      expect(response.status).toBe(200);
    }
  });
});

describe.skipIf(!databaseUrl)('chat global budget (integration)', () => {
  const INTERNAL_KEY = 'k'.repeat(32);
  let created: Awaited<ReturnType<typeof createChatIntegrationApp>>;

  beforeAll(async () => {
    created = await createChatIntegrationApp(databaseUrl as string, {
      embeddings: new FakeEmbeddings(),
      agentModel: new FakeAgentModel(),
      env: {
        CHAT_THROTTLE_LIMIT: '1000',
        CHAT_GLOBAL_LIMIT_PER_MINUTE: '3',
        INTERNAL_API_KEY: INTERNAL_KEY,
      },
    });
  });

  afterAll(async () => {
    await created?.app.close();
  });

  function post(headers: Record<string, string>): Promise<Response> {
    return fetch(`${created.apiUrl}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ threadId: randomUUID(), message: 'hello' }),
    });
  }

  it('caps chat requests across all visitors, whatever their IP or forged headers', async () => {
    const statuses: number[] = [];
    // Different "visitors", and one forging x-client-ip without the key.
    const callers: Record<string, string>[] = [
      { 'x-internal-key': INTERNAL_KEY, 'x-client-ip': '203.0.113.1' },
      { 'x-internal-key': INTERNAL_KEY, 'x-client-ip': '203.0.113.2' },
      { 'x-internal-key': INTERNAL_KEY, 'x-client-ip': '203.0.113.3' },
      { 'x-internal-key': INTERNAL_KEY, 'x-client-ip': '203.0.113.4' },
      { 'x-client-ip': '203.0.113.5' },
    ];
    let last: Response | undefined;
    for (const headers of callers) {
      last = await post(headers);
      statuses.push(last.status);
      await last.clone().text();
    }
    expect(statuses).toEqual([200, 200, 200, 429, 429]);

    const retryAfter = Number(last?.headers.get('retry-after'));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(await last?.json()).toMatchObject({
      statusCode: 429,
      message: 'The assistant is busy, please try again in a minute.',
    });
  });

  it('does not spend the global budget on history reads', async () => {
    for (let i = 0; i < 6; i += 1) {
      const response = await fetch(`${created.apiUrl}/chat/${randomUUID()}`);
      expect(response.status).toBe(200);
    }
  });
});
