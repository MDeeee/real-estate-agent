import { randomUUID } from 'node:crypto';
import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { HumanMessage, RemoveMessage } from '@langchain/core/messages';
import type { BookingSummary } from '../bookings/bookings.service.js';
import type { TokenUsage } from '../llm/agent-model.js';
import { RECURSION_LIMIT, TRIM_NODE } from './agent-graph.js';
import { AgentGraphService } from './agent-graph.service.js';
import {
  type AgentStateType,
  type AssistantExtras,
  type RestorableKey,
  type SearchSummary,
  initialValues,
} from './agent-state.js';
import type { ChatCard } from './chat-card.js';
import type { ChatEvent, NodeEvent } from './chat-events.js';
import { USAGE_KEY, messageText } from './nodes/node-support.js';
import { maskPhone, maskPhonesInText, threadLogId } from './pii.js';

export const TURN_TIMEOUT_MS = 60_000;

export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  text: string;
  properties?: ChatCard[];
  booking?: BookingSummary;
  search?: SearchSummary;
}

const GENERIC_ERROR = 'The assistant could not answer. Please try again.';
const TIMEOUT_ERROR =
  'The assistant took too long to answer. Please try again.';
export const THREAD_BUSY_MESSAGE =
  'Your previous message is still being handled. Please try again in a moment.';

/** Everything a turn can change besides `messages`; restored when the turn fails. */
const RESTORED_KEYS = Object.keys(initialValues()) as RestorableKey[];

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The state after a turn, folded from the per-node updates the graph streams. */
interface TurnOutcome {
  reply: string;
  intent: AgentStateType['intent'];
  filters: AgentStateType['filters'];
  candidates: number;
  citedSlugs: string[];
}

function emptyOutcome(): TurnOutcome {
  return {
    reply: '',
    intent: null,
    filters: {},
    candidates: 0,
    citedSlugs: [],
  };
}

function foldUpdate(
  outcome: TurnOutcome,
  update: Partial<AgentStateType> | undefined,
): void {
  if (!update) return;
  if (update.intent !== undefined) outcome.intent = update.intent;
  if (update.filters !== undefined) outcome.filters = update.filters;
  if (update.candidates !== undefined) {
    outcome.candidates = update.candidates.length;
  }
  if (update.citedSlugs !== undefined) outcome.citedSlugs = update.citedSlugs;
  const reply = update.messages?.findLast(
    (message) => message.getType() === 'ai',
  );
  if (reply) outcome.reply = messageText(reply);
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger('Chat');
  private readonly activeThreads = new Set<string>();

  constructor(
    @Inject(AgentGraphService) private readonly agent: AgentGraphService,
  ) {}

  /**
   * One turn at a time per conversation; returns the release function. The lock
   * lives in this process, so it protects a single API instance only.
   */
  acquire(threadId: string): () => void {
    if (this.activeThreads.has(threadId)) {
      throw new ConflictException(THREAD_BUSY_MESSAGE);
    }
    this.activeThreads.add(threadId);
    return () => {
      this.activeThreads.delete(threadId);
    };
  }

  /**
   * Runs one turn. A turn that fails, times out or is abandoned by the client
   * is rolled back before the generator finishes (and so before the caller
   * releases the lock), leaving the conversation exactly as it was.
   */
  async *run(
    threadId: string,
    message: string,
    clientSignal: AbortSignal,
  ): AsyncGenerator<ChatEvent> {
    const startedAt = performance.now();
    const log = threadLogId(threadId);
    const config = { configurable: { thread_id: threadId } };
    const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    const timeout = AbortSignal.timeout(TURN_TIMEOUT_MS);
    const signal = AbortSignal.any([clientSignal, timeout]);

    let before: Awaited<ReturnType<AgentGraphService['graph']['getState']>>;
    try {
      before = await this.agent.graph.getState(config);
    } catch (error) {
      yield* this.failure(log, error, false);
      return;
    }
    const existed = before.config.configurable?.['checkpoint_id'] !== undefined;
    const beforeValues = before.values as Partial<AgentStateType>;
    const previousIds = new Set((beforeValues.messages ?? []).map((m) => m.id));

    const outcome = emptyOutcome();
    let committed = false;
    let failure: unknown;
    try {
      const stream = await this.agent.graph.stream(
        {
          messages: [new HumanMessage({ id: randomUUID(), content: message })],
        },
        {
          configurable: { thread_id: threadId, [USAGE_KEY]: usage },
          streamMode: ['custom', 'updates'],
          recursionLimit: RECURSION_LIMIT,
          signal,
        },
      );
      for await (const [mode, payload] of stream) {
        if (mode === 'custom') {
          yield payload as NodeEvent;
        } else {
          for (const update of Object.values(payload)) {
            foldUpdate(outcome, update as Partial<AgentStateType> | undefined);
          }
        }
      }
      committed = true;
    } catch (error) {
      failure = error;
    } finally {
      // Also runs when the caller stops iterating early (the client is gone).
      if (!committed) {
        await this.rollback(threadId, log, existed, beforeValues, previousIds);
      }
    }

    if (!committed) {
      if (clientSignal.aborted) return;
      yield* this.failure(log, failure, timeout.aborted);
      return;
    }

    this.logger.log(
      JSON.stringify({
        event: 'chat_turn',
        thread: log,
        intent: outcome.intent,
        filters: outcome.filters,
        candidates: outcome.candidates,
        citedSlugs: outcome.citedSlugs,
        latencyMs: Math.round(performance.now() - startedAt),
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      }),
    );

    yield {
      type: 'final',
      text: outcome.reply,
      citedSlugs: outcome.citedSlugs,
      intent: outcome.intent,
    };
    yield { type: 'done' };
  }

  private *failure(
    log: string,
    error: unknown,
    timedOut: boolean,
  ): Generator<ChatEvent> {
    this.logger.error(
      JSON.stringify({
        event: 'chat_turn_failed',
        thread: log,
        timedOut,
        error: describeError(error),
      }),
    );
    yield { type: 'error', message: timedOut ? TIMEOUT_ERROR : GENERIC_ERROR };
    yield { type: 'done' };
  }

  /**
   * Puts the conversation back to its pre-turn state: removes every message the
   * turn added (the visitor's and any partial replies) and restores the other
   * channels. A conversation that did not exist before is deleted outright.
   */
  private async rollback(
    threadId: string,
    log: string,
    existed: boolean,
    previous: Partial<AgentStateType>,
    previousIds: ReadonlySet<string | undefined>,
  ): Promise<void> {
    try {
      if (!existed) {
        await this.agent.checkpointer.deleteThread(threadId);
        return;
      }
      const config = { configurable: { thread_id: threadId } };
      const current = await this.agent.graph.getState(config);
      const added = (
        (current.values as Partial<AgentStateType>).messages ?? []
      ).filter(({ id }) => id !== undefined && !previousIds.has(id));
      const defaults = initialValues();
      const restored = Object.fromEntries(
        RESTORED_KEYS.map((key) => [key, previous[key] ?? defaults[key]]),
      );
      await this.agent.graph.updateState(
        config,
        {
          ...restored,
          messages: added.map(({ id }) => new RemoveMessage({ id: id ?? '' })),
        },
        TRIM_NODE,
      );
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'chat_rollback_failed',
          thread: log,
          error: describeError(error),
        }),
      );
    }
  }

  /** The stored conversation for the page; phone numbers are masked. */
  async history(threadId: string): Promise<ChatHistoryMessage[]> {
    const snapshot = await this.agent.graph.getState({
      configurable: { thread_id: threadId },
    });
    const messages =
      (snapshot.values as Partial<AgentStateType>).messages ?? [];
    return messages.flatMap((message): ChatHistoryMessage[] => {
      const type = message.getType();
      const text = maskPhonesInText(messageText(message));
      if (type === 'human') return [{ role: 'user', text }];
      if (type !== 'ai') return [];
      const extras = message.additional_kwargs as AssistantExtras;
      return [
        {
          role: 'assistant',
          text,
          ...(extras.properties && { properties: extras.properties }),
          ...(extras.booking && {
            booking: {
              ...extras.booking,
              phone: maskPhone(extras.booking.phone),
            },
          }),
          ...(extras.search && { search: extras.search }),
        },
      ];
    });
  }
}
