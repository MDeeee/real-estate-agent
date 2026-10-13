import { AIMessage } from '@langchain/core/messages';
import type { AgentStateType } from '../src/agent/agent-state.js';
import { extractCitations } from '../src/agent/citations.js';
import {
  detailsGroundingSlugs,
  searchGroundingSlugs,
} from '../src/agent/grounding.js';
import { messageText } from '../src/agent/nodes/node-support.js';
import { refusalReply } from '../src/agent/replies.js';
import type { Observation } from './scoring.js';

/** What one graph turn left behind. */
export interface TurnOutcome {
  /** The graph state after the turn; fields the turn did not touch are stale. */
  state: Pick<
    AgentStateType,
    'intent' | 'filters' | 'candidates' | 'messages' | 'bookingDraft'
  >;
  /** Everything the model streamed this turn, before the citation post-check. */
  rawAnswer: string;
  /** Listing cards the turn put on screen (its `properties` event), in order. */
  shownSlugs: readonly string[];
}

/** Totals over every turn of the conversation. */
export interface ConversationTotals {
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Observes the LAST turn of a conversation, keeping only what that turn's
 * intent produced. The graph state is shared across turns, so a details turn
 * still carries the filters and candidates of the earlier search: reporting
 * them would score the wrong turn.
 *  - search: the filters and ranked candidates extracted this turn;
 *  - details: the listing the reference resolved to, read from the card the
 *    turn showed (the state's `focusSlug` would be stale if it resolved to none);
 *  - book: the listing the booking draft points at;
 *  - anything else: none of these.
 * Allowed citations follow the production rule (`agent/grounding.ts`).
 */
export function observeLastTurn(
  { state, rawAnswer, shownSlugs }: TurnOutcome,
  totals: ConversationTotals,
): Observation {
  const reply = messageText(
    state.messages.findLast((message) => message.getType() === 'ai') ??
      new AIMessage(''),
  );
  const isSearch = state.intent === 'search';
  const isDetails = state.intent === 'details';
  const retrievedSlugs = isSearch
    ? state.candidates.map(({ slug }) => slug)
    : null;
  let focusSlug: string | null = null;
  if (isDetails && shownSlugs.length === 1) focusSlug = shownSlugs[0] ?? null;
  else if (state.intent === 'book') {
    focusSlug = state.bookingDraft.propertySlug ?? null;
  }

  let grounding = new Set<string>();
  if (isSearch) grounding = searchGroundingSlugs(state.candidates);
  else if (isDetails && focusSlug) grounding = detailsGroundingSlugs(focusSlug);

  return {
    intent: state.intent,
    filters: isSearch ? state.filters : null,
    retrievedSlugs,
    focusSlug,
    groundingSlugs: [...grounding],
    citations: extractCitations(rawAnswer),
    hasAnswer: rawAnswer.trim().length > 0,
    refused: reply === refusalReply('en') || reply === refusalReply('ar'),
    reply,
    conversationLatencyMs: totals.latencyMs,
    conversationInputTokens: totals.inputTokens,
    conversationOutputTokens: totals.outputTokens,
  };
}
