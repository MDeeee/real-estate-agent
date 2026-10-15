import {
  type BaseCheckpointSaver,
  END,
  START,
  StateGraph,
} from '@langchain/langgraph';
import type { AgentGraphDeps } from './agent-graph.types.js';
import { AgentState } from './agent-state.js';
import { createAnswerNode } from './nodes/answer.js';
import { createBookNode } from './nodes/book.js';
import { createDetailsNode } from './nodes/details.js';
import { createRetrieveNode } from './nodes/retrieve.js';
import { createRefuseNode, createSmalltalkNode } from './nodes/static-reply.js';
import { trimNode } from './nodes/trim.js';
import { NODE_FOR_INTENT, createUnderstandNode } from './nodes/understand.js';

/** Upper bound on graph steps per turn; the longest path (search) takes four. */
export const RECURSION_LIMIT = 12;

/** Final node of every path; also the node a rolled-back turn is recorded as. */
export const TRIM_NODE = 'trim';

export function buildAgentGraph(
  deps: AgentGraphDeps,
  checkpointer: BaseCheckpointSaver,
) {
  return new StateGraph(AgentState)
    .addNode('understand', createUnderstandNode(deps))
    .addNode('retrieve', createRetrieveNode(deps))
    .addNode('answer', createAnswerNode(deps))
    .addNode('details', createDetailsNode(deps))
    .addNode('book', createBookNode(deps))
    .addNode('smalltalk', createSmalltalkNode(deps))
    .addNode('refuse', createRefuseNode(deps))
    .addNode(TRIM_NODE, trimNode)
    .addEdge(START, 'understand')
    .addConditionalEdges(
      'understand',
      (state) => NODE_FOR_INTENT[state.intent ?? 'off_topic'],
      Object.values(NODE_FOR_INTENT),
    )
    .addEdge('retrieve', 'answer')
    .addEdge('answer', TRIM_NODE)
    .addEdge('details', TRIM_NODE)
    .addEdge('book', TRIM_NODE)
    .addEdge('smalltalk', TRIM_NODE)
    .addEdge('refuse', TRIM_NODE)
    .addEdge(TRIM_NODE, END)
    .compile({ checkpointer });
}

export type AgentGraph = ReturnType<typeof buildAgentGraph>;
