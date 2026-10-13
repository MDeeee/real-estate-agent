import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import type { Candidate } from '../src/agent/agent-state.js';
import { refusalReply } from '../src/agent/replies.js';
import { type TurnOutcome, observeLastTurn } from './observe.js';

const totals = { latencyMs: 9000, inputTokens: 300, outputTokens: 40 };

function candidate(slug: string): Candidate {
  return { slug, title: slug, card: {}, snippet: '' } as unknown as Candidate;
}

function outcome(overrides: Partial<TurnOutcome> = {}): TurnOutcome {
  return {
    state: {
      intent: 'search',
      filters: { city: 'Sheikh Zayed', listing: 'SALE' },
      candidates: [candidate('a-one'), candidate('b-two')],
      messages: [new HumanMessage('hi'), new AIMessage('answer')],
    },
    rawAnswer: '',
    shownSlugs: [],
    ...overrides,
  };
}

describe('observeLastTurn', () => {
  it('reports filters, ranked candidates and their grounding set for a search turn', () => {
    const observed = observeLastTurn(
      outcome({ rawAnswer: 'Try [a-one] or [ghost-villa].' }),
      totals,
    );
    expect(observed.filters).toEqual({ city: 'Sheikh Zayed', listing: 'SALE' });
    expect(observed.retrievedSlugs).toEqual(['a-one', 'b-two']);
    expect(observed.focusSlug).toBeNull();
    expect(observed.groundingSlugs).toEqual(['a-one', 'b-two']);
    expect(observed.citations).toEqual(['a-one', 'ghost-villa']);
    expect(observed.hasAnswer).toBe(true);
  });

  it('does not report stale search state for a details turn', () => {
    const observed = observeLastTurn(
      outcome({
        state: { ...outcome().state, intent: 'details' },
        shownSlugs: ['b-two'],
        rawAnswer: 'It has a garden [b-two].',
      }),
      totals,
    );
    expect(observed.filters).toBeNull();
    expect(observed.retrievedSlugs).toBeNull();
    expect(observed.focusSlug).toBe('b-two');
  });

  it('allows a details answer to cite only the detail card, as production does', () => {
    const observed = observeLastTurn(
      outcome({
        state: { ...outcome().state, intent: 'details' },
        shownSlugs: ['b-two'],
        rawAnswer: 'Compare with [a-one].',
      }),
      totals,
    );
    // a-one is among the earlier candidates but not the card shown this turn.
    expect(observed.groundingSlugs).toEqual(['b-two']);
    expect(observed.citations).toEqual(['a-one']);
  });

  it('resolves to nothing when the details turn showed no card', () => {
    const observed = observeLastTurn(
      outcome({ state: { ...outcome().state, intent: 'details' } }),
      totals,
    );
    expect(observed.focusSlug).toBeNull();
    expect(observed.groundingSlugs).toEqual([]);
  });

  it('observes neither search nor details state for other intents', () => {
    const observed = observeLastTurn(
      outcome({ state: { ...outcome().state, intent: 'book' } }),
      totals,
    );
    expect(observed.filters).toBeNull();
    expect(observed.retrievedSlugs).toBeNull();
    expect(observed.focusSlug).toBeNull();
    expect(observed.groundingSlugs).toEqual([]);
  });

  it('detects the standard refusal and carries the conversation totals', () => {
    const observed = observeLastTurn(
      outcome({
        state: {
          ...outcome().state,
          intent: 'off_topic',
          messages: [new AIMessage(refusalReply('en'))],
        },
      }),
      totals,
    );
    expect(observed.refused).toBe(true);
    expect(observed.conversationLatencyMs).toBe(9000);
    expect(observed.conversationInputTokens).toBe(300);
    expect(observed.conversationOutputTokens).toBe(40);
  });
});
