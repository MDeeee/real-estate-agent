import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.schema.js';
import {
  ProviderBusyError,
  ProviderUnavailableError,
} from '../llm/provider-errors.js';
import { createGraphHarness } from '../testing/chat-fixtures.js';
import type { AgentGraphService } from './agent-graph.service.js';
import type { ChatEvent } from './chat-events.js';
import { ChatService, describeError } from './chat.service.js';

type Harness = ReturnType<typeof createGraphHarness>;

function serviceFor(h: Harness, turnTimeoutMs = 90_000) {
  return new ChatService(
    {
      graph: h.graph,
      checkpointer: h.checkpointer,
    } as unknown as AgentGraphService,
    { get: () => turnTimeoutMs } as unknown as ConfigService<Env, true>,
  );
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

  it('times out a turn after the configured CHAT_TURN_TIMEOUT_MS and rolls it back', async () => {
    const h = createGraphHarness();
    const slow = serviceFor(h, 50);
    const thread = randomUUID();
    h.model.classify = ((_input: unknown, options?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () =>
          reject(new Error('aborted')),
        );
      })) as never;

    const events = await drain(slow, thread, 'apartments in New Cairo');

    expect(events.at(-2)).toEqual({
      type: 'error',
      message: 'The assistant took too long to answer. Please try again.',
      code: 'timeout',
    });
    expect(await slow.history(thread)).toEqual([]);
  });

  describe('a busy or too slow AI provider', () => {
    const BUSY_EN =
      'The AI provider is busy right now. Please try again in a minute.';

    function logged() {
      const lines: Record<string, unknown>[] = [];
      vi.spyOn(Logger.prototype, 'error').mockImplementation((m: unknown) => {
        lines.push(JSON.parse(String(m)) as Record<string, unknown>);
      });
      return lines;
    }

    it('ends the turn with a distinct friendly event and rolls it back', async () => {
      const h = createGraphHarness();
      const service = serviceFor(h);
      const thread = randomUUID();
      await drain(service, thread, 'hello');
      const before = await service.history(thread);
      const lines = logged();
      h.model.classify = () => Promise.reject(new ProviderBusyError('busy'));

      const events = await drain(service, thread, 'apartments in New Cairo');

      expect(events.slice(-2)).toEqual([
        { type: 'error', message: BUSY_EN, code: 'provider_busy' },
        { type: 'done' },
      ]);
      expect(await service.history(thread)).toEqual(before);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        event: 'chat_turn_failed',
        reason: 'provider_busy',
      });
      // One call for "hello" and one for the failed turn: a busy provider is not retried.
      expect(h.model.understandCalls).toHaveLength(2);
    });

    it('says the assistant is unavailable, not busy, for a quota or key failure', async () => {
      const h = createGraphHarness();
      const service = serviceFor(h);
      const thread = randomUUID();
      await drain(service, thread, 'hello');
      const before = await service.history(thread);
      const lines = logged();
      h.model.classify = () => Promise.reject(new ProviderUnavailableError());

      const events = await drain(service, thread, 'apartments in New Cairo');

      expect(events.slice(-2)).toEqual([
        {
          type: 'error',
          message: 'The AI assistant is not available right now.',
          code: 'provider_unavailable',
        },
        { type: 'done' },
      ]);
      expect(await service.history(thread)).toEqual(before);
      expect(lines[0]).toMatchObject({
        event: 'chat_turn_failed',
        reason: 'provider_quota_or_auth',
      });
      // Not retried: one call for "hello", one for the failed turn.
      expect(h.model.understandCalls).toHaveLength(2);
    });

    it('also says it in Arabic', async () => {
      const h = createGraphHarness();
      const service = serviceFor(h);
      const thread = randomUUID();
      await drain(service, thread, 'شقة للإيجار في الشيخ زايد');
      logged();
      h.model.classify = () => Promise.reject(new ProviderUnavailableError());
      const events = await drain(service, thread, 'عايز فيلا في التجمع الخامس');
      expect(events.at(-2)).toEqual({
        type: 'error',
        message: 'المساعد الذكي غير متاح حالياً.',
        code: 'provider_unavailable',
      });
    });

    it('treats a single call that timed out the same way', async () => {
      const h = createGraphHarness();
      const service = serviceFor(h);
      logged();
      h.model.classify = () => Promise.reject(new ProviderBusyError('timeout'));
      const events = await drain(service, randomUUID(), 'apartments');
      expect(events.at(-2)).toEqual({
        type: 'error',
        message: BUSY_EN,
        code: 'provider_busy',
      });
    });

    it('also covers a failure while the answer streams', async () => {
      const h = createGraphHarness();
      const service = serviceFor(h);
      const thread = randomUUID();
      logged();
      h.model.streamAnswer = ((): AsyncGenerator<string> => {
        throw new ProviderBusyError('busy');
      }) as never;
      const events = await drain(service, thread, 'apartments in New Cairo');
      expect(events.at(-2)).toMatchObject({ code: 'provider_busy' });
      expect(await service.history(thread)).toEqual([]);
    });

    it('speaks Arabic in an Arabic conversation', async () => {
      const h = createGraphHarness();
      const service = serviceFor(h);
      const thread = randomUUID();
      await drain(service, thread, 'شقة للإيجار في الشيخ زايد');
      logged();
      h.model.classify = () => Promise.reject(new ProviderBusyError('busy'));

      const events = await drain(service, thread, 'عايز فيلا في التجمع الخامس');

      const error = events.at(-2);
      expect(error).toMatchObject({ type: 'error', code: 'provider_busy' });
      expect((error as { message: string }).message).toMatch(/[؀-ۿ]/);
    });

    it('keeps the generic and the turn timeout errors apart from it', async () => {
      const h = createGraphHarness();
      const service = serviceFor(h);
      const lines = logged();
      h.model.classify = () => Promise.reject(new Error('provider down'));
      const generic = await drain(service, randomUUID(), 'apartments');
      expect(generic.at(-2)).toEqual({
        type: 'error',
        message: 'The assistant could not answer. Please try again.',
        code: 'error',
      });

      const slow = serviceFor(h, 30);
      h.model.classify = ((
        _input: unknown,
        options?: { signal?: AbortSignal },
      ) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        })) as never;
      const timedOut = await drain(slow, randomUUID(), 'apartments');
      expect(timedOut.at(-2)).toMatchObject({ code: 'timeout' });

      expect(lines.map((line) => line['reason'])).toEqual([
        'error',
        'timeout',
      ]);
    });
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

  describe('a turn that already booked', () => {
    const BOOK =
      'book the first one, my name is Test User, 01001234567 2026-10-19 17:00';

    async function bookedThread() {
      const h = createGraphHarness();
      const service = serviceFor(h);
      const thread = randomUUID();
      await drain(service, thread, 'apartments in New Cairo');
      return { h, service, thread };
    }

    function expectConfirmed(
      history: Awaited<ReturnType<ChatService['history']>>,
    ) {
      expect(history.map((m) => m.role)).toEqual([
        'user',
        'assistant',
        'user',
        'assistant',
      ]);
      expect(
        history.filter((m) => m.text.startsWith('book the first one')),
      ).toHaveLength(1);
      const confirmation = history.at(-1);
      expect(confirmation?.booking).toMatchObject({
        propertySlug: 'alpha-apartment',
        preferredDate: '2026-10-19',
        preferredTime: '17:00',
      });
      expect(confirmation?.text).toContain('Your viewing is confirmed');
    }

    it('is kept when the client aborts as soon as the booking event arrives', async () => {
      const { h, service, thread } = await bookedThread();
      const abort = new AbortController();
      const types: string[] = [];
      for await (const event of service.run(thread, BOOK, abort.signal)) {
        types.push(event.type);
        if (event.type === 'booking') abort.abort();
      }

      expect(h.createBooking).toHaveBeenCalledOnce();
      expectConfirmed(await service.history(thread));
      expect((await stateOf(h, thread)).values.bookingDraft).toEqual({});
      expect(types).not.toContain('error');
    });

    it('is kept, with the confirmation stored, when the abort cuts the turn before its update is saved', async () => {
      const { h, service, thread } = await bookedThread();
      const abort = new AbortController();
      const create = h.createBooking.getMockImplementation();
      h.createBooking.mockImplementation(async (input: never) => {
        const result = await (create as (i: never) => Promise<unknown>)(input);
        abort.abort();
        return result;
      });

      const events = await drain(service, thread, BOOK, abort.signal);

      // The client is gone, so nothing is sent back.
      expect(events.map((e) => e.type)).not.toContain('error');
      expect(h.createBooking).toHaveBeenCalledOnce();
      expectConfirmed(await service.history(thread));
      const state = await stateOf(h, thread);
      expect(state.values.bookingDraft).toEqual({});
      expect(state.values.focusSlug).toBe('alpha-apartment');
    });

    it('is kept when the caller stops reading right after the booking event', async () => {
      const { h, service, thread } = await bookedThread();
      const iterator = service.run(thread, BOOK, new AbortController().signal);
      for (;;) {
        const next = await iterator.next();
        if (next.done || next.value.type === 'booking') break;
      }
      await iterator.return(undefined);

      expect(h.createBooking).toHaveBeenCalledOnce();
      expectConfirmed(await service.history(thread));
    });

    it('still rolls back an abort that happens before any booking exists', async () => {
      const { h, service, thread } = await bookedThread();
      const before = await service.history(thread);
      const abort = new AbortController();
      h.model.extractBooking = (() => {
        abort.abort();
        return Promise.reject(new Error('aborted'));
      }) as never;
      await drain(service, thread, BOOK, abort.signal);
      expect(h.createBooking).not.toHaveBeenCalled();
      expect(await service.history(thread)).toEqual(before);
    });
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

});

describe('describeError', () => {
  it('joins the message and the cause chain', () => {
    const error = new Error('outer', { cause: new Error('inner') });
    expect(describeError(error)).toBe('outer <- inner');
  });

  it('never throws on a circular cause or a BigInt', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    const error = new Error('wrapped', { cause: circular });
    expect(() => describeError(error)).not.toThrow();
    expect(describeError(error)).toContain('wrapped <- ');
    expect(describeError(10n)).toBe('10');
    expect(describeError(undefined)).toBe('');
  });
});
