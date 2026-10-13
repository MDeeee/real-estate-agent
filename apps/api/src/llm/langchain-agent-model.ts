import { Inject, Injectable } from '@nestjs/common';
import {
  AIMessage,
  AIMessageChunk,
  type BaseMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import type { ZodType, z } from 'zod';
import type {
  AgentModel,
  AnswerInput,
  BookingExtraction,
  BookingExtractionInput,
  ConversationTurn,
  DetailsInput,
  ModelCallOptions,
  TokenUsage,
  UnderstandInput,
  Understanding,
} from './agent-model.js';
import { ChatModelFactory } from './chat-model.factory.js';
import { bookingExtractionSchema, understandingSchema } from './llm-schemas.js';
import {
  StructuredOutputError,
  asProviderError,
} from './provider-errors.js';
import {
  type ChatPrompt,
  type PromptMessage,
  answerPrompt,
  detailsPrompt,
  extractBookingMessages,
  understandMessages,
} from './prompts.js';

function toLangChain(messages: PromptMessage[]): BaseMessage[] {
  return messages.map(({ role, content }) =>
    role === 'system' ? new SystemMessage(content) : new HumanMessage(content),
  );
}

function toChatMessages(prompt: ChatPrompt): BaseMessage[] {
  const history = prompt.history.map(({ role, text }: ConversationTurn) =>
    role === 'user' ? new HumanMessage(text) : new AIMessage(text),
  );
  return [new SystemMessage(prompt.system), ...history];
}

function chunkText(chunk: AIMessageChunk): string {
  const { content } = chunk;
  if (typeof content === 'string') return content;
  return content
    .map((part) =>
      part.type === 'text' && typeof part.text === 'string' ? part.text : '',
    )
    .join('');
}

function addUsage(
  usage: TokenUsage | undefined,
  metadata: { input_tokens?: number; output_tokens?: number } | undefined,
): void {
  if (!usage || !metadata) return;
  usage.inputTokens += metadata.input_tokens ?? 0;
  usage.outputTokens += metadata.output_tokens ?? 0;
}

@Injectable()
export class LangChainAgentModel implements AgentModel {
  constructor(
    @Inject(ChatModelFactory) private readonly factory: ChatModelFactory,
  ) {}

  isConfigured(): boolean {
    return this.factory.isConfigured();
  }

  async understand(
    input: UnderstandInput,
    options?: ModelCallOptions,
  ): Promise<Understanding> {
    const result = await this.structured(
      'understand',
      understandingSchema,
      toLangChain(understandMessages(input)),
      options,
    );
    return {
      intent: result.intent,
      searchMode: result.searchMode,
      semanticQuery: result.semanticQuery.trim(),
      propertyRef: result.propertyRef?.trim() || undefined,
      filters: result.filters,
    };
  }

  async extractBooking(
    input: BookingExtractionInput,
    options?: ModelCallOptions,
  ): Promise<BookingExtraction> {
    const result = await this.structured(
      'extract_booking',
      bookingExtractionSchema,
      toLangChain(extractBookingMessages(input)),
      options,
    );
    return {
      propertyRef: result.propertyRef?.trim() || undefined,
      name: result.name?.trim() || undefined,
      phone: result.phone?.trim() || undefined,
      preferredDate: result.preferredDate?.trim() || undefined,
      preferredTime: result.preferredTime?.trim() || undefined,
      anyTime: result.anyTime,
      timeVague: result.timeVague,
    };
  }

  streamAnswer(
    input: AnswerInput,
    options?: ModelCallOptions,
  ): AsyncIterable<string> {
    return this.stream(toChatMessages(answerPrompt(input)), options);
  }

  answerDetails(
    input: DetailsInput,
    options?: ModelCallOptions,
  ): AsyncIterable<string> {
    return this.stream(toChatMessages(detailsPrompt(input)), options);
  }

  /**
   * One structured-output call, bounded by `LLM_CALL_TIMEOUT_MS`. A provider
   * that answers 429/503/"overloaded", or does not answer in time, surfaces as
   * a `ProviderBusyError` so the turn can end at once.
   */
  private async structured<TSchema extends ZodType<Record<string, unknown>>>(
    name: string,
    schema: TSchema,
    messages: BaseMessage[],
    options: ModelCallOptions = {},
  ): Promise<z.output<TSchema>> {
    const runnable = this.factory.create().withStructuredOutput?.(schema, {
      name,
      method: this.factory.structuredMethod,
      includeRaw: true,
    });
    if (!runnable) {
      throw new Error(
        'The configured chat model does not support structured output.',
      );
    }
    const timeout = AbortSignal.timeout(this.factory.callTimeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeout])
      : timeout;
    let result: { raw: BaseMessage; parsed: z.output<TSchema> | null };
    try {
      result = (await runnable.invoke(messages, { signal })) as typeof result;
    } catch (error) {
      throw asProviderError(error, {
        callTimedOut: timeout.aborted,
        aborted: options.signal?.aborted === true,
      });
    }
    addUsage(options.usage, (result.raw as AIMessage).usage_metadata);
    if (result.parsed === null || result.parsed === undefined) {
      throw new StructuredOutputError(name);
    }
    return result.parsed;
  }

  /**
   * A streamed answer. The per-call timeout is the wait for the first token:
   * once the provider is answering, the turn deadline bounds the rest.
   */
  private async *stream(
    messages: BaseMessage[],
    options: ModelCallOptions = {},
  ): AsyncGenerator<string> {
    const callTimeout = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      callTimeout.abort();
    }, this.factory.callTimeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, callTimeout.signal])
      : callTimeout.signal;
    let combined: AIMessageChunk | undefined;
    try {
      const chunks = await this.factory.create().stream(messages, { signal });
      for await (const chunk of chunks) {
        clearTimeout(timer);
        const aiChunk = chunk as AIMessageChunk;
        combined = combined ? combined.concat(aiChunk) : aiChunk;
        const text = chunkText(aiChunk);
        if (text) yield text;
      }
    } catch (error) {
      throw asProviderError(error, {
        callTimedOut: timedOut,
        aborted: options.signal?.aborted === true,
      });
    } finally {
      clearTimeout(timer);
    }
    addUsage(options.usage, combined?.usage_metadata);
  }
}
