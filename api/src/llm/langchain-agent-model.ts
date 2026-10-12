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
  Classification,
  ClassifyInput,
  ConversationTurn,
  DetailsInput,
  ExtractFiltersInput,
  ModelCallOptions,
  TokenUsage,
} from './agent-model.js';
import { ChatModelFactory } from './chat-model.factory.js';
import {
  bookingExtractionSchema,
  classificationSchema,
  llmFilterSchema,
} from './llm-schemas.js';
import {
  type ChatPrompt,
  type PromptMessage,
  answerPrompt,
  classifyMessages,
  detailsPrompt,
  extractBookingMessages,
  extractFiltersMessages,
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

  async classify(
    input: ClassifyInput,
    options?: ModelCallOptions,
  ): Promise<Classification> {
    const result = await this.structured(
      'classify',
      classificationSchema,
      toLangChain(classifyMessages(input)),
      options,
    );
    return {
      intent: result.intent,
      semanticQuery: result.semanticQuery.trim(),
      propertyRef: result.propertyRef?.trim() || undefined,
    };
  }

  extractFilters(
    input: ExtractFiltersInput,
    options?: ModelCallOptions,
  ): Promise<Record<string, unknown>> {
    return this.structured(
      'extract_filters',
      llmFilterSchema,
      toLangChain(extractFiltersMessages(input)),
      options,
    );
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
    const { raw, parsed } = (await runnable.invoke(messages, {
      signal: options.signal,
    })) as { raw: BaseMessage; parsed: z.output<TSchema> | null };
    addUsage(options.usage, (raw as AIMessage).usage_metadata);
    if (parsed === null || parsed === undefined) {
      throw new Error(`The model returned no valid "${name}" output.`);
    }
    return parsed;
  }

  private async *stream(
    messages: BaseMessage[],
    options: ModelCallOptions = {},
  ): AsyncGenerator<string> {
    let combined: AIMessageChunk | undefined;
    const chunks = await this.factory
      .create()
      .stream(messages, { signal: options.signal });
    for await (const chunk of chunks) {
      const aiChunk = chunk as AIMessageChunk;
      combined = combined ? combined.concat(aiChunk) : aiChunk;
      const text = chunkText(aiChunk);
      if (text) yield text;
    }
    addUsage(options.usage, combined?.usage_metadata);
  }
}
