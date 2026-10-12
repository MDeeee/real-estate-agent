import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGraphHarness } from '../testing/chat-fixtures.js';
import type { AgentGraphService } from './agent-graph.service.js';
import type { ChatEvent } from './chat-events.js';
import { ChatService } from './chat.service.js';
import { threadLogId } from './pii.js';

type Harness = ReturnType<typeof createGraphHarness>;

function serviceFor(h: Harness) {
  return new ChatService({
    graph: h.graph,
    checkpointer: h.checkpointer,
  } as unknown as AgentGraphService);
}

async function drain(
  service: ChatService,
  threadId: string,
  message: string,
  signal: AbortSignal = new AbortController().signal,
): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const event of service.run(threadId, message, signal)) {
    events.push(event);
  }
  return events;
}

function stateOf(h: Harness, threadId: string) {
  return h.graph.getState({ configurable: { thread_id: threadId } });
}

function makeAnswerFail(h: Harness): () => void {
  const original = h.model.streamAnswer.bind(h.model);
  h.model.streamAnswer = ((): AsyncGenerator<string> => {
    throw new Error('provider down');
  }) as never;
  return () => {
    h.model.streamAnswer = original;
  };
}

describe('ChatService turn rollback', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('leaves the history and the search state unchanged when the model fails', async () => {
    const h = createGraphHarness();
    const service = serviceFor(h);
    const thread = randomUUID();
    await drain(service, thread, 'quiet apartment in New Cairo');
    const historyBefore = await service.history(thread);
    const before = await stateOf(h, thread);

    makeAnswerFail(h);
    const events = await drain(service, thread, 'something cheaper');

    expect(events.map((e) => e.type).slice(-2)).toEqual(['error', 'done']);
    expect(await service.history(thread)).toEqual(historyBefore);
    const after = await stateOf(h, thread);
    // The partial turn had already refined the filters; they are back.
    expect(before.values.filters.priceMax).toBeUndefined();
    expect(after.values.filters).toEqual(before.values.filters);
    expect(after.values.semanticQuery).toBe('quiet street');
    expect(after.values.semanticQuery).toBe(before.values.semanticQuery);
    expect(after.values.candidates).toEqual(before.values.candidates);
    expect(after.values.citedSlugs).toEqual(before.values.citedSlugs);
    expect(after.values.focusSlug).toEqual(before.values.focusSlug);
    expect(after.values.bookingDraft).toEqual(before.values.bookingDraft);
  });

  it('after a failure a retry leaves exactly one human message for the turn', async () => {
    const h = createGraphHarness();
    const service = serviceFor(h);
    const thread = randomUUID();
    await drain(service, thread, 'apartments in New Cairo');

    const restore = makeAnswerFail(h);
    await drain(service, thread, 'something cheaper');
    restore();
    await drain(service, thread, 'something cheaper');

    const history = await service.history(thread);
    expect(history.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(history.filter((m) => m.text === 'something cheaper')).toHaveLength(
      1,
    );
  });

  it('removes a conversation whose very first turn failed', async () => {
    const h = createGraphHarness();
    const service = serviceFor(h);
    const thread = randomUUID();
    makeAnswerFail(h);

    const events = await drain(service, thread, 'apartments in New Cairo');

    expect(events.at(-2)?.type).toBe('error');
    expect(await service.history(thread)).toEqual([]);
    expect(
      await h.checkpointer.getTuple({ configurable: { thread_id: thread } }),
    ).toBeUndefined();
  });

  it('rolls back a turn the client abandoned (abort), keeping booking progress', async () => {
    const h = createGraphHarness();
    const service = serviceFor(h);
    const thread = randomUUID();
    await drain(service, thread, 'apartments in New Cairo');
    await drain(service, thread, 'book the first one');
    const before = await stateOf(h, thread);
    expect(before.values.bookingDraft.propertySlug).toBe('alpha-apartment');

    const abort = new AbortController();
    h.model.extractBooking = (() => {
      abort.abort();
      return Promise.reject(new Error('aborted'));
    }) as never;
    const events = await drain(
      service,
      thread,
      'my name is Test User',
      abort.signal,
    );

    // The client is gone: no error or final event is produced for it.
    expect(events.map((e) => e.type)).not.toContain('error');
    expect(events.map((e) => e.type)).not.toContain('final');
    const after = await stateOf(h, thread);
    expect(after.values.messages.map((m: { id?: string }) => m.id)).toEqual(
      before.values.messages.map((m: { id?: string }) => m.id),
    );
    expect(after.values.bookingDraft).toEqual(before.values.bookingDraft);
  });

  it('rolls back when the caller stops reading mid-stream', async () => {
    const h = createGraphHarness();
    const service = serviceFor(h);
    const thread = randomUUID();
    await drain(service, thread, 'hello');
    const before = await service.history(thread);

    const iterator = service.run(
      thread,
      'apartments in New Cairo',
      new AbortController().signal,
    );
    await iterator.next();
    await iterator.return(undefined);

    expect(await service.history(thread)).toEqual(before);
  });

  it('does not log the raw thread id', async () => {
    const h = createGraphHarness();
    const service = serviceFor(h);
    const thread = randomUUID();
    const lines: string[] = [];
    vi.spyOn(Logger.prototype, 'log').mockImplementation((m: unknown) => {
      lines.push(String(m));
    });
    vi.spyOn(Logger.prototype, 'error').mockImplementation((m: unknown) => {
      lines.push(String(m));
    });

    await drain(service, thread, 'hello');
    h.model.classify = () => Promise.reject(new Error('provider down'));
    await drain(service, thread, 'hello again');

    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).not.toContain(thread);
      expect(line).toContain(threadLogId(thread));
    }
  });

  it('keeps the thread lock until released and answers 409 neutrally', () => {
    const service = serviceFor(createGraphHarness());
    const release = service.acquire('t');
    expect(() => service.acquire('t')).toThrow(/still being handled/);
    release();
    expect(() => service.acquire('t')).not.toThrow();
  });
});

describe('ChatService history', () => {
  it('masks phone numbers in booking cards and in message text', async () => {
    const h = createGraphHarness();
    const service = serviceFor(h);
    const thread = randomUUID();
    await drain(service, thread, 'apartments in New Cairo');
    await drain(
      service,
      thread,
      'book the first one, my name is Test User, 01001234567 2026-10-19',
    );

    const history = await service.history(thread);
    const booked = history.find((m) => m.booking);
    expect(booked?.booking?.phone).toBe('010****4567');
    expect(JSON.stringify(history)).not.toContain('01001234567');
    expect(history.some((m) => m.text.includes('010****4567'))).toBe(true);
  });
});
