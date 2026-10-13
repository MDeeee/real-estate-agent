import { describe, expect, it } from 'vitest';
import {
  type CaseResult,
  describeFailures,
  renderCaseTable,
  renderMetricsTable,
} from './report.js';
import { type Observation, scoreCase } from './scoring.js';

const observed: Observation = {
  intent: 'search',
  filters: { listing: 'RENT' },
  retrievedSlugs: ['a-one'],
  focusSlug: null,
  groundingSlugs: ['a-one'],
  citations: ['a-one', 'ghost-villa'],
  hasAnswer: true,
  refused: false,
  reply: 'Here are two options.',
  conversationLatencyMs: 2500,
  conversationInputTokens: 100,
  conversationOutputTokens: 20,
};

function result(overrides: Partial<CaseResult> = {}): CaseResult {
  const expectation = {
    intent: 'search',
    filters: { listing: 'SALE' },
    anyOfSlugs: ['b-two'],
    noneOfSlugs: ['a-one'],
  } as const;
  return {
    id: 'sample-case',
    turns: ['hi'],
    expect: expectation,
    observed,
    score: scoreCase(expectation, observed),
    attempts: 1,
    ...overrides,
  };
}

describe('describeFailures', () => {
  it('names each failed aspect with expected and actual values', () => {
    const lines = describeFailures(result());
    expect(lines).toEqual([
      'sample-case: filter listing expected "SALE", got "RENT"',
      'sample-case: none of [b-two] in results [a-one]',
      'sample-case: excluded listing(s) returned: a-one',
      'sample-case: citation(s) outside the retrieved listings: ghost-villa',
    ]);
  });

  it('reports a crashed case with its error', () => {
    expect(
      describeFailures(result({ observed: null, error: 'provider down' })),
    ).toEqual(['sample-case: crashed: provider down']);
  });

  it('describes a failed reference and ignores stale search state', () => {
    const turn: Observation = {
      ...observed,
      intent: 'details',
      filters: null,
      retrievedSlugs: null,
      focusSlug: 'c-three',
      hasAnswer: false,
      citations: [],
    };
    const expectation = {
      intent: 'details',
      focusSlug: ['a-one', 'b-two'],
    } as const;
    expect(
      describeFailures(
        result({
          expect: expectation,
          observed: turn,
          score: scoreCase(expectation, turn),
        }),
      ),
    ).toEqual([
      'sample-case: reference expected one of [a-one, b-two], resolved to c-three',
    ]);
  });

  it('is empty for a passing case', () => {
    const passing: Observation = {
      ...observed,
      filters: { listing: 'SALE' },
      retrievedSlugs: ['b-two'],
      groundingSlugs: ['b-two'],
      citations: ['b-two'],
    };
    const expectation = {
      intent: 'search',
      filters: { listing: 'SALE' },
      anyOfSlugs: ['b-two'],
    } as const;
    expect(
      describeFailures(
        result({
          expect: expectation,
          observed: passing,
          score: scoreCase(expectation, passing),
        }),
      ),
    ).toEqual([]);
  });
});

describe('tables', () => {
  it('shows one row per case with marks, filter counts, latency and tokens', () => {
    const table = renderCaseTable([result()]);
    const row = table.split('\n')[2] ?? '';
    expect(row).toContain('sample-case');
    expect(row).toContain('0/1');
    expect(row).toContain('FAIL');
    expect(row).toContain('2.5s');
    expect(row).toContain('120');
    expect(table.split('\n')[0]).toContain('Latency (all turns)');
    expect(table.split('\n')[0]).toContain('Tokens (all turns)');
  });

  it('marks regressed metrics and shows the delta to the baseline', () => {
    const metrics = {
      intentAccuracy: 1,
      filterAccuracy: 0.8,
      hitAt5: null,
      exclusion: 1,
      referenceAccuracy: 1,
      groundedness: 1,
      refusalCorrectness: 1,
      avgConversationLatencyMs: 1000,
      totalTokens: 500,
    };
    const table = renderMetricsTable(
      metrics,
      { ...metrics, filterAccuracy: 0.9 },
      [{ metric: 'filterAccuracy', baseline: 0.9, current: 0.8, drop: 0.1 }],
    );
    const filterRow = table.split('\n').find((l) => l.startsWith('Filter'));
    expect(filterRow).toContain('80.0%');
    expect(filterRow).toContain('-10.0 pt');
    expect(filterRow).toContain('REGRESSION');
    expect(table).toContain('n/a');
  });
});
