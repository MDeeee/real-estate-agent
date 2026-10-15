import { describe, expect, it } from 'vitest';
import { createTestReplies } from '../src/testing/replies.js';
import {
  type CaseOutcome,
  type Expectation,
  type Observation,
  aggregate,
  findRegressions,
  scoreCase,
  scoreFilters,
} from './scoring.js';

const replies = createTestReplies();

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    intent: 'search',
    filters: {},
    retrievedSlugs: [],
    focusSlug: null,
    groundingSlugs: [],
    citations: [],
    hasAnswer: false,
    refused: false,
    reply: 'Here are two options.',
    conversationLatencyMs: 1000,
    conversationInputTokens: 10,
    conversationOutputTokens: 5,
    ...overrides,
  };
}

describe('scoreFilters', () => {
  it('counts matches over the expected fields only', () => {
    const score = scoreFilters(
      { city: 'Sheikh Zayed', type: 'apartment', priceMax: 30000 },
      {
        city: 'sheikh zayed',
        type: 'apartment',
        priceMax: 25000,
        bedroomsMin: 2,
      },
    );
    expect(score.matched).toBe(2);
    expect(score.total).toBe(3);
    expect(score.mismatches).toEqual([
      { field: 'priceMax', expected: 30000, actual: 25000 },
    ]);
  });

  it('treats a missing field as a mismatch', () => {
    const score = scoreFilters({ listing: 'RENT' }, {});
    expect(score.mismatches).toEqual([
      { field: 'listing', expected: 'RENT', actual: undefined },
    ]);
  });

  it('ignores expected fields that are undefined', () => {
    expect(scoreFilters({ city: undefined }, {})).toEqual({
      matched: 0,
      total: 0,
      mismatches: [],
    });
  });
});

describe('scoreCase', () => {
  const expected: Expectation = {
    intent: 'search',
    filters: { listing: 'SALE' },
    anyOfSlugs: ['a-one', 'b-two'],
    noneOfSlugs: ['c-three'],
  };

  it('passes a fully correct turn', () => {
    const score = scoreCase(
      expected,
      observation({
        filters: { listing: 'SALE' },
        retrievedSlugs: ['d-four', 'b-two'],
        hasAnswer: true,
        groundingSlugs: ['d-four', 'b-two'],
        citations: ['b-two'],
      }),
    );
    expect(score).toEqual({
      intent: true,
      filters: { matched: 1, total: 1, mismatches: [] },
      hit: true,
      exclusion: true,
      reference: null,
      grounded: true,
      refusal: true,
    });
  });

  it('fails the retrieval aspects independently', () => {
    const score = scoreCase(
      expected,
      observation({
        filters: { listing: 'RENT' },
        retrievedSlugs: ['c-three'],
      }),
    );
    expect(score.filters?.matched).toBe(0);
    expect(score.hit).toBe(false);
    expect(score.exclusion).toBe(false);
  });

  it('only looks at the top five results', () => {
    const score = scoreCase(
      expected,
      observation({
        filters: { listing: 'SALE' },
        retrievedSlugs: ['x-1', 'x-2', 'x-3', 'x-4', 'x-5', 'a-one', 'c-three'],
      }),
    );
    expect(score.hit).toBe(false);
    expect(score.exclusion).toBe(true);
  });

  it('flags a citation outside the retrieved listings as ungrounded', () => {
    const score = scoreCase(
      { intent: 'search' },
      observation({
        hasAnswer: true,
        groundingSlugs: ['a-one'],
        citations: ['a-one', 'invented-villa'],
      }),
    );
    expect(score.grounded).toBe(false);
  });

  it('does not test groundedness when no answer was generated', () => {
    expect(
      scoreCase({ intent: 'book' }, observation({ intent: 'book' })).grounded,
    ).toBeNull();
  });

  it('skips aspects the case does not expect', () => {
    const score = scoreCase({ intent: 'search' }, observation());
    expect(score.filters).toBeNull();
    expect(score.hit).toBeNull();
    expect(score.exclusion).toBeNull();
  });

  it('requires the refusal exactly when it is expected', () => {
    const refusal: Expectation = { intent: 'off_topic', expectRefusal: true };
    expect(
      scoreCase(refusal, observation({ intent: 'off_topic', refused: true }))
        .refusal,
    ).toBe(true);
    expect(
      scoreCase(refusal, observation({ intent: 'off_topic' })).refusal,
    ).toBe(false);
    expect(
      scoreCase({ intent: 'search' }, observation({ refused: true })).refusal,
    ).toBe(false);
  });

  it('requires an empty result when no hits are expected', () => {
    const none: Expectation = { intent: 'search', expectNoHits: true };
    expect(scoreCase(none, observation({ retrievedSlugs: [] })).exclusion).toBe(
      true,
    );
    expect(
      scoreCase(none, observation({ retrievedSlugs: ['a-one'] })).exclusion,
    ).toBe(false);
    expect(
      scoreCase(
        none,
        observation({ intent: 'smalltalk', retrievedSlugs: null }),
      ).exclusion,
    ).toBe(false);
    expect(
      scoreCase(
        { intent: 'search' },
        observation({ retrievedSlugs: ['a-one'] }),
      ).exclusion,
    ).toBeNull();
  });

  it('checks the reply language together with the refusal', () => {
    const arabicRefusal: Expectation = {
      intent: 'off_topic',
      expectRefusal: true,
      replyLanguage: 'ar',
    };
    const base = { intent: 'off_topic', refused: true } as const;
    expect(
      scoreCase(
        arabicRefusal,
        observation({ ...base, reply: replies.refusal('ar') }),
      ).refusal,
    ).toBe(true);
    expect(
      scoreCase(
        arabicRefusal,
        observation({ ...base, reply: replies.refusal('en') }),
      ).refusal,
    ).toBe(false);
    // No language stated: either language passes.
    expect(
      scoreCase(
        { intent: 'off_topic', expectRefusal: true },
        observation({ ...base, reply: replies.refusal('en') }),
      ).refusal,
    ).toBe(true);
  });

  it('fails every tested aspect when the case crashed', () => {
    expect(scoreCase(expected, null)).toEqual({
      intent: false,
      filters: { matched: 0, total: 1, mismatches: [] },
      hit: false,
      exclusion: false,
      reference: null,
      grounded: null,
      refusal: false,
    });
  });

  describe('details turns', () => {
    const details: Expectation = {
      intent: 'details',
      focusSlug: ['a-one', 'b-two'],
    };

    it('scores the resolved reference, not retrieval', () => {
      const score = scoreCase(
        details,
        observation({
          intent: 'details',
          filters: null,
          retrievedSlugs: null,
          focusSlug: 'b-two',
        }),
      );
      expect(score).toEqual({
        intent: true,
        filters: null,
        hit: null,
        exclusion: null,
        reference: true,
        grounded: null,
        refusal: true,
      });
    });

    it('fails when the reference resolved to another listing or none', () => {
      const wrong = observation({
        intent: 'details',
        filters: null,
        retrievedSlugs: null,
        focusSlug: 'c-three',
      });
      expect(scoreCase(details, wrong).reference).toBe(false);
      expect(scoreCase(details, { ...wrong, focusSlug: null }).reference).toBe(
        false,
      );
      expect(scoreCase(details, null).reference).toBe(false);
    });
  });

  describe('stale state', () => {
    it('fails search expectations on a turn that was not a search', () => {
      const score = scoreCase(
        {
          intent: 'search',
          filters: { listing: 'SALE' },
          anyOfSlugs: ['a-one'],
          noneOfSlugs: ['c-three'],
        },
        observation({
          intent: 'details',
          filters: null,
          retrievedSlugs: null,
          focusSlug: 'a-one',
        }),
      );
      expect(score.intent).toBe(false);
      expect(score.filters).toEqual({ matched: 0, total: 1, mismatches: [] });
      expect(score.hit).toBe(false);
      expect(score.exclusion).toBe(false);
    });
  });
});

describe('aggregate', () => {
  function outcome(
    expectation: Expectation,
    observed: Observation,
  ): CaseOutcome {
    return { observed, score: scoreCase(expectation, observed) };
  }

  it('computes ratios over the cases that test each aspect', () => {
    const metrics = aggregate([
      outcome(
        {
          intent: 'search',
          filters: { listing: 'SALE', type: 'villa' },
          anyOfSlugs: ['a-one'],
        },
        observation({
          filters: { listing: 'SALE', type: 'apartment' },
          retrievedSlugs: ['a-one'],
          conversationLatencyMs: 2000,
        }),
      ),
      outcome(
        { intent: 'off_topic', expectRefusal: true },
        observation({
          intent: 'off_topic',
          refused: true,
          conversationLatencyMs: 1000,
        }),
      ),
      outcome(
        { intent: 'search', noneOfSlugs: ['z-nine'] },
        observation({ intent: 'details', retrievedSlugs: ['z-nine'] }),
      ),
    ]);
    expect(metrics.intentAccuracy).toBeCloseTo(2 / 3);
    expect(metrics.filterAccuracy).toBeCloseTo(1 / 2);
    expect(metrics.hitAt5).toBe(1);
    expect(metrics.exclusion).toBe(0);
    expect(metrics.groundedness).toBeNull();
    expect(metrics.refusalCorrectness).toBe(1);
    expect(metrics.referenceAccuracy).toBeNull();
    expect(metrics.avgConversationLatencyMs).toBeCloseTo(4000 / 3);
    expect(metrics.totalTokens).toBe(45);
  });

  it('reports null for aspects nothing tested', () => {
    expect(aggregate([])).toEqual({
      intentAccuracy: null,
      filterAccuracy: null,
      hitAt5: null,
      exclusion: null,
      referenceAccuracy: null,
      groundedness: null,
      refusalCorrectness: null,
      avgConversationLatencyMs: null,
      totalTokens: null,
    });
  });
});

describe('findRegressions', () => {
  const baseline = {
    intentAccuracy: 1,
    filterAccuracy: 0.9,
    hitAt5: 0.8,
    exclusion: 1,
    referenceAccuracy: 1,
    groundedness: 1,
    refusalCorrectness: 1,
    avgConversationLatencyMs: 5000,
    totalTokens: 1000,
  };

  it('allows drops up to the tolerance and flags larger ones', () => {
    const regressions = findRegressions(
      { ...baseline, hitAt5: 0.75, filterAccuracy: 0.8 },
      baseline,
      0.05,
    );
    expect(regressions.map(({ metric }) => metric)).toEqual(['filterAccuracy']);
    expect(regressions[0]?.drop).toBeCloseTo(0.1);
  });

  it('ignores improvements, metrics the baseline lacked, latency and tokens', () => {
    expect(
      findRegressions(
        {
          ...baseline,
          hitAt5: 1,
          avgConversationLatencyMs: 60_000,
          totalTokens: 99_999,
        },
        { ...baseline, referenceAccuracy: null },
        0.05,
      ),
    ).toEqual([]);
  });

  it('counts a metric that is a number in the baseline but null now as a regression', () => {
    expect(
      findRegressions({ ...baseline, intentAccuracy: null }, baseline, 0.05),
    ).toEqual([
      { metric: 'intentAccuracy', baseline: 1, current: null, drop: 1 },
    ]);
  });

  it('fails any drop when the tolerance is zero', () => {
    expect(
      findRegressions({ ...baseline, exclusion: 0.99 }, baseline, 0),
    ).toHaveLength(1);
  });
});
