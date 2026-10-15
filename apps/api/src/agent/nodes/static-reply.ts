import type { AgentGraphDeps } from '../agent-graph.types.js';
import type { AgentStateType, AgentStateUpdate } from '../agent-state.js';
import { assistantMessage } from './node-support.js';

export function createSmalltalkNode({ replies }: AgentGraphDeps) {
  return (state: AgentStateType): AgentStateUpdate => ({
    messages: [assistantMessage(replies.smalltalk(state.language))],
    citedSlugs: [],
  });
}

export function createRefuseNode({ replies }: AgentGraphDeps) {
  return (state: AgentStateType): AgentStateUpdate => ({
    messages: [assistantMessage(replies.refusal(state.language))],
    citedSlugs: [],
  });
}
