import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import type { AgentGraphDeps } from '../agent-graph.types.js';
import type {
  AgentStateType,
  AgentStateUpdate,
  Candidate,
} from '../agent-state.js';
import { emit } from './node-support.js';

export function createRetrieveNode({ retrieval }: AgentGraphDeps) {
  return async (
    state: AgentStateType,
    config: LangGraphRunnableConfig,
  ): Promise<AgentStateUpdate> => {
    const results = await retrieval.retrieve(
      state.filters,
      state.semanticQuery,
    );
    const candidates: Candidate[] = results.map(({ card, snippet }) => ({
      slug: card.slug,
      title: card.title,
      card,
      snippet,
    }));
    emit(config, { type: 'properties', items: candidates.map((c) => c.card) });
    return {
      candidates,
      focusSlug: candidates.length === 1 ? (candidates[0]?.slug ?? null) : null,
    };
  };
}
