import { RemoveMessage } from '@langchain/core/messages';
import type { AgentStateType, AgentStateUpdate } from '../agent-state.js';

/** Messages kept in a conversation's checkpoints; older ones are removed after each turn. */
export const MAX_STORED_MESSAGES = 20;

/**
 * Last node of every path: bounds the stored history so checkpoints (and the
 * prompts built from them) do not grow without limit. The kept window starts
 * with a visitor message so no reply is left without its question.
 */
export function trimNode(state: AgentStateType): AgentStateUpdate {
  const { messages } = state;
  if (messages.length <= MAX_STORED_MESSAGES) return {};
  let start = messages.length - MAX_STORED_MESSAGES;
  const firstVisitor = messages.findIndex(
    (message, index) => index >= start && message.getType() === 'human',
  );
  if (firstVisitor > start) start = firstVisitor;
  return {
    messages: messages
      .slice(0, start)
      .flatMap(({ id }) => (id ? [new RemoveMessage({ id })] : [])),
  };
}
