import { AIMessageChunk } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import type { ChatModelFactory } from './chat-model.factory.js';
import { LangChainAgentModel } from './langchain-agent-model.js';
import { ProviderBusyError, StructuredOutputError } from './provider-errors.js';

const nulls = {
  city: null,
  compound: null,
  district: null,
  type: null,
  listing: null,
  priceMin: null,
  priceMax: null,
  bedroomsMin: null,
  bathroomsMin: null,
  areaMin: null,
  areaMax: null,
};

const understandInput = {
  messages: [{ role: 'user' as const, text: 'villa in New Cairo' }],
  candidates: [],
  bookingInProgress: false,
  previousFilters: {},
  previousSemanticQuery: '',
  today: '2026-10-12',
  facets: { cities: [], compounds: [] },
};

type Invoke = (
  messages: unknown,
  options: { signal: AbortSignal },
) => Promise<unknown>;

function modelWith(
  chat: { invoke?: Invoke; stream?: unknown },
  callTimeoutMs = 40,
) {
  const factory = {
    create: () => ({
      withStructuredOutput: () => ({ invoke: chat.invoke }),
      stream: chat.stream,
    }),
    structuredMethod: 'functionCalling',
    callTimeoutMs,
    isConfigured: () => true,
  } as unknown as ChatModelFactory;
  return new LangChainAgentModel(factory);
}

/** Never answers; rejects once its signal aborts, like a real HTTP client. */
const hang: Invoke = (_messages, { signal }) =>
  new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  });

describe('LangChainAgentModel.understand', () => {
  it('returns the intent, the reference and the filters of one call', async () => {
    const model = modelWith({
      invoke: () =>
        Promise.resolve({
          raw: { usage_metadata: { input_tokens: 10, output_tokens: 5 } },
          parsed: {
            intent: 'search',
            searchMode: 'new',
            semanticQuery: ' quiet ',
            propertyRef: null,
            filters: { ...nulls, type: 'villa', city: 'New Cairo' },
          },
        }),
    });
    const usage = { inputTokens: 0, outputTokens: 0 };
    const result = await model.understand(understandInput, { usage });
    expect(result).toEqual({
      intent: 'search',
      searchMode: 'new',
      semanticQuery: 'quiet',
      propertyRef: undefined,
      filters: { ...nulls, type: 'villa', city: 'New Cairo' },
    });
    expect(usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it('throws a StructuredOutputError when nothing parsed', async () => {
    const model = modelWith({
      invoke: () => Promise.resolve({ raw: {}, parsed: null }),
    });
    await expect(model.understand(understandInput)).rejects.toBeInstanceOf(
      StructuredOutputError,
    );
  });

  it('turns a 429 or 503 into a ProviderBusyError at once', async () => {
    for (const status of [429, 503]) {
      const model = modelWith({
        invoke: () => Promise.reject(Object.assign(new Error('x'), { status })),
      });
      await expect(model.understand(understandInput)).rejects.toMatchObject({
        name: 'ProviderBusyError',
        kind: 'busy',
      });
    }
  });

  it('ends a call that exceeds the per-call timeout as a provider timeout', async () => {
    const model = modelWith({ invoke: hang }, 20);
    const started = Date.now();
    await expect(model.understand(understandInput)).rejects.toMatchObject({
      name: 'ProviderBusyError',
      kind: 'timeout',
    });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('does not blame the provider when the turn itself was aborted', async () => {
    const model = modelWith({ invoke: hang }, 5000);
    const turn = new AbortController();
    setTimeout(() => turn.abort(), 10);
    const error = await model
      .understand(understandInput, { signal: turn.signal })
      .catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(ProviderBusyError);
    expect((error as Error).message).toBe('aborted');
  });

  it('keeps other errors as they are', async () => {
    const model = modelWith({
      invoke: () => Promise.reject(new TypeError('bug')),
    });
    await expect(model.understand(understandInput)).rejects.toBeInstanceOf(
      TypeError,
    );
  });
});

describe('LangChainAgentModel streaming', () => {
  const answerInput = {
    language: 'en' as const,
    messages: [{ role: 'user' as const, text: 'hi' }],
    filters: {},
    listings: [],
  };

  async function collect(stream: AsyncIterable<string>): Promise<string> {
    let text = '';
    for await (const part of stream) text += part;
    return text;
  }

  it('streams the text of the chunks', async () => {
    const model = modelWith({
      stream: () =>
        Promise.resolve(
          (async function* () {
            yield new AIMessageChunk('Hel');
            yield new AIMessageChunk('lo');
          })(),
        ),
    });
    expect(await collect(model.streamAnswer(answerInput))).toBe('Hello');
  });

  it('times out when no token arrives within the per-call timeout', async () => {
    const model = modelWith(
      {
        stream: (_messages: unknown, { signal }: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      },
      20,
    );
    await expect(
      collect(model.streamAnswer(answerInput)),
    ).rejects.toMatchObject({ name: 'ProviderBusyError', kind: 'timeout' });
  });

  it('does not cut a stream that is already answering', async () => {
    const model = modelWith(
      {
        stream: () =>
          Promise.resolve(
            (async function* () {
              yield new AIMessageChunk('a');
              await new Promise((done) => setTimeout(done, 60));
              yield new AIMessageChunk('b');
            })(),
          ),
      },
      30,
    );
    expect(await collect(model.streamAnswer(answerInput))).toBe('ab');
  });

  it('maps a 503 while connecting to a ProviderBusyError', async () => {
    const model = modelWith({
      stream: () => Promise.reject(Object.assign(new Error('x'), { status: 503 })),
    });
    await expect(
      collect(model.streamAnswer(answerInput)),
    ).rejects.toBeInstanceOf(ProviderBusyError);
  });
});
