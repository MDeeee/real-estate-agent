import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import type { AgentGraphDeps } from '../agent-graph.types.js';
import type { AgentStateType, AgentStateUpdate } from '../agent-state.js';
import { sanitiseCitations } from '../citations.js';
import { emptyAnswerReply } from '../replies.js';
import {
  assistantMessage,
  callOptions,
  emit,
  recentTurns,
} from './node-support.js';

async function collect(
  tokens: AsyncIterable<string>,
  config: LangGraphRunnableConfig,
): Promise<string> {
  let text = '';
  for await (const token of tokens) {
    text += token;
    emit(config, { type: 'token', text: token });
  }
  return text;
}

export function createAnswerNode({ model, logger }: AgentGraphDeps) {
  return async (
    state: AgentStateType,
    config: LangGraphRunnableConfig,
  ): Promise<AgentStateUpdate> => {
    const raw = await collect(
      model.streamAnswer(
        {
          language: state.language,
          messages: recentTurns(state.messages),
          filters: state.filters,
          listings: state.candidates.map(({ card, snippet }) => ({
            card,
            snippet,
          })),
        },
        callOptions(config),
      ),
      config,
    );

    const allowed = new Set(state.candidates.map(({ slug }) => slug));
    const { text, citedSlugs, dropped } = sanitiseCitations(raw, allowed);
    if (dropped.length > 0) {
      logger.warn(
        `Dropped ungrounded citations from the answer: ${dropped.join(', ')}`,
      );
    }

    return {
      messages: [
        assistantMessage(text || emptyAnswerReply(state.language), {
          properties: state.candidates.map(({ card }) => card),
          search: {
            filters: state.filters,
            semanticQuery: state.semanticQuery,
          },
        }),
      ],
      citedSlugs,
    };
  };
}
