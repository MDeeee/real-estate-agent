import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import type { AgentGraphDeps } from '../agent-graph.types.js';
import type {
  AgentStateType,
  AgentStateUpdate,
  Candidate,
} from '../agent-state.js';
import { sanitiseCitations } from '../citations.js';
import { detailsGroundingSlugs } from '../grounding.js';
import {
  SLUG_LIKE,
  ordinalBeyondCount,
  resolveCandidate,
} from '../listing-reference.js';
import {
  assistantMessage,
  callOptions,
  emit,
  recentTurns,
} from './node-support.js';

/**
 * Which listing the visitor means: the one they named or numbered, else the one
 * in focus, else the only one on screen.
 */
export function resolveListingSlug(
  state: Pick<AgentStateType, 'propertyRef' | 'candidates' | 'focusSlug'>,
): { slug: string; shown: boolean } | undefined {
  const ref = state.propertyRef ?? undefined;
  const shown: Candidate | undefined = ref
    ? resolveCandidate(ref, state.candidates)
    : (state.candidates.find(({ slug }) => slug === state.focusSlug) ??
      (state.candidates.length === 1 ? state.candidates[0] : undefined));
  if (shown) return { slug: shown.slug, shown: true };
  if (ref && SLUG_LIKE.test(ref)) return { slug: ref, shown: false };
  return undefined;
}

/**
 * No listing could be resolved. When the visitor numbered one beyond the
 * listings the last search found ("the second one" after a single result), say
 * what the search found; the generic "search first" only when there is none.
 */
function unresolvedReply(
  state: AgentStateType,
  replies: AgentGraphDeps['replies'],
): string {
  const count = state.candidates.length;
  const latest = recentTurns(state.messages).findLast(
    (turn) => turn.role === 'user',
  )?.text;
  const beyond =
    count > 0 &&
    ((latest !== undefined && ordinalBeyondCount(latest, count)) ||
      (state.propertyRef !== null &&
        ordinalBeyondCount(state.propertyRef, count, { bareNumber: true })));
  return beyond
    ? replies.ordinalBeyondResults(
        state.language,
        state.candidates.map(({ title }) => title),
      )
    : replies.unknownListing(state.language);
}

export function createDetailsNode({
  model,
  listings,
  logger,
  replies,
}: AgentGraphDeps) {
  const reply = (text: string): AgentStateUpdate => ({
    messages: [assistantMessage(text)],
    citedSlugs: [],
  });

  return async (
    state: AgentStateType,
    config: LangGraphRunnableConfig,
  ): Promise<AgentStateUpdate> => {
    const target = resolveListingSlug(state);
    if (!target) return reply(unresolvedReply(state, replies));

    const detail = await listings.detail(target.slug);
    if (!detail) {
      return reply(
        target.shown
          ? replies.listingUnavailable(state.language)
          : replies.unknownListing(state.language),
      );
    }
    emit(config, { type: 'properties', items: [detail.card] });

    let raw = '';
    for await (const token of model.answerDetails(
      {
        language: state.language,
        messages: recentTurns(state.messages),
        card: detail.card,
        body: detail.body,
      },
      callOptions(config),
    )) {
      raw += token;
      emit(config, { type: 'token', text: token });
    }

    const { text, citedSlugs, dropped } = sanitiseCitations(
      raw,
      detailsGroundingSlugs(detail.card.slug),
    );
    if (dropped.length > 0) {
      logger.warn(
        `Dropped ungrounded citations from the answer: ${dropped.join(', ')}`,
      );
    }
    return {
      messages: [
        assistantMessage(text || replies.emptyAnswer(state.language), {
          properties: [detail.card],
        }),
      ],
      citedSlugs,
      focusSlug: detail.card.slug,
    };
  };
}
