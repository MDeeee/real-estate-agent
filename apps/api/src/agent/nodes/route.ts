import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import type { Intent } from '../../llm/agent-model.js';
import type { AgentGraphDeps } from '../agent-graph.types.js';
import { detectLanguage } from '../language.js';
import type { AgentStateType, AgentStateUpdate } from '../agent-state.js';
import { callOptions, emit, recentTurns } from './node-support.js';

export const NODE_FOR_INTENT = {
  search: 'extract_filters',
  details: 'details',
  book: 'book',
  smalltalk: 'smalltalk',
  off_topic: 'refuse',
} as const satisfies Record<Intent, string>;

function hasBookingInProgress(state: AgentStateType): boolean {
  return Object.values(state.bookingDraft).some((value) => value !== undefined);
}

export function createRouteNode({ model }: AgentGraphDeps) {
  return async (
    state: AgentStateType,
    config: LangGraphRunnableConfig,
  ): Promise<AgentStateUpdate> => {
    emit(config, { type: 'status', stage: 'thinking' });
    const turns = recentTurns(state.messages);
    const classification = await model.classify(
      {
        messages: turns,
        candidates: state.candidates.map(({ slug, title }) => ({
          slug,
          title,
        })),
        bookingInProgress: hasBookingInProgress(state),
        previousSemanticQuery: state.semanticQuery,
      },
      callOptions(config),
    );
    return {
      intent: classification.intent,
      // Decided from the visitor's own letters, not by the (unreliable) classifier.
      language: detectLanguage(
        turns.findLast((turn) => turn.role === 'user')?.text ?? '',
        state.language,
      ),
      // Only a search restates the preferences; other turns keep the last ones.
      ...(classification.intent === 'search' && {
        searchMode: classification.searchMode,
        semanticQuery: classification.semanticQuery,
      }),
      propertyRef: classification.propertyRef ?? null,
      citedSlugs: [],
    };
  };
}
