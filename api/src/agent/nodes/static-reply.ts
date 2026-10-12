import type { AgentStateType, AgentStateUpdate } from '../agent-state.js';
import { refusalReply, smalltalkReply } from '../replies.js';
import { assistantMessage } from './node-support.js';

export function smalltalkNode(state: AgentStateType): AgentStateUpdate {
  return {
    messages: [assistantMessage(smalltalkReply(state.language))],
    citedSlugs: [],
  };
}

export function refuseNode(state: AgentStateType): AgentStateUpdate {
  return {
    messages: [assistantMessage(refusalReply(state.language))],
    citedSlugs: [],
  };
}
