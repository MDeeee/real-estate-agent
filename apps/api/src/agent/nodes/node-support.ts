import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import type {
  ConversationTurn,
  ModelCallOptions,
  TokenUsage,
} from '../../llm/agent-model.js';
import type { BookingSummary } from '../../bookings/bookings.service.js';
import type { NodeEvent } from '../chat-events.js';
import type { AssistantExtras } from '../agent-state.js';

const RECENT_MESSAGES = 8;

export const USAGE_KEY = 'usage';

export const TURN_BOOKING_KEY = 'turnBooking';

/**
 * Filled by the book node the moment a booking exists, so the chat service
 * knows about it even when the turn is cut off before the node's update (or
 * its `booking` event) reaches the stream.
 */
export interface TurnBooking {
  booking?: BookingSummary;
  /** `false` when the visitor's earlier identical booking was reused. */
  created?: boolean;
}

export function recordBooking(
  config: LangGraphRunnableConfig,
  booking: BookingSummary,
  created: boolean,
): void {
  const turn = config.configurable?.[TURN_BOOKING_KEY] as
    TurnBooking | undefined;
  if (turn) {
    turn.booking = booking;
    turn.created = created;
  }
}

export function emit(config: LangGraphRunnableConfig, event: NodeEvent): void {
  config.writer?.(event);
}

export function callOptions(config: LangGraphRunnableConfig): ModelCallOptions {
  const usage = config.configurable?.[USAGE_KEY] as TokenUsage | undefined;
  return { signal: config.signal, usage };
}

export function isAborted(config: LangGraphRunnableConfig): boolean {
  return config.signal?.aborted === true;
}

export function messageText(message: BaseMessage): string {
  return typeof message.content === 'string' ? message.content : message.text;
}

/** The latest turns as plain role/text pairs, always starting with the visitor. */
export function recentTurns(
  messages: readonly BaseMessage[],
): ConversationTurn[] {
  const turns = messages
    .slice(-RECENT_MESSAGES)
    .flatMap((message): ConversationTurn[] => {
      const type = message.getType();
      if (type !== 'human' && type !== 'ai') return [];
      return [
        {
          role: type === 'human' ? 'user' : 'assistant',
          text: messageText(message),
        },
      ];
    });
  const firstUser = turns.findIndex((turn) => turn.role === 'user');
  return firstUser <= 0 ? turns : turns.slice(firstUser);
}

export function assistantMessage(
  text: string,
  extras: AssistantExtras = {},
): AIMessage {
  return new AIMessage({ content: text, additional_kwargs: { ...extras } });
}
