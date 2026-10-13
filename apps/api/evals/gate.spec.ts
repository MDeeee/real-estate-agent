import { describe, expect, it } from 'vitest';
import type { Baseline } from './baseline.js';
import {
  type GateInput,
  decideBaselineUpdate,
  describeGate,
  evaluateGate,
} from './gate.js';
import type { Metrics } from './scoring.js';

const metrics: Metrics = {
  intentAccuracy: 1,
  filterAccuracy: 1,
  hitAt5: 1,
  exclusion: 1,
  referenceAccuracy: 1,
  groundedness: 1,
  refusalCorrectness: 1,
  avgConversationLatencyMs: 1000,
  totalTokens: 100,
};

const baseline: Baseline = {
  version: 1,
  createdAt: '2026-10-12T00:00:00.000Z',
  provider: 'claude',
  model: 'claude-haiku-5-5',
  metrics,
};

function input(overrides: Partial<GateInput> = {}): GateInput {
  return {
    baseline,
    current: { provider: 'claude', model: 'claude-haiku-5-5', metrics },
    tolerance: 0.05,
    subset: false,
    ci: false,
    allowModelMismatch: false,
    ...overrides,
  };
}

describe('evaluateGate', () => {
  it('passes a full run that matches the baseline', () => {
    const report = describeGate(evaluateGate(input()), 5);
    expect(report.failed).toBe(false);
    expect(report.message).toContain('Eval passed');
  });

  it('fails a full run with a regression, including a metric that went null', () => {
    const result = evaluateGate(
      input({
        current: {
          provider: 'claude',
          model: 'claude-haiku-5-5',
          metrics: { ...metrics, hitAt5: 0.5, groundedness: null },
        },
      }),
    );
    expect(result).toMatchObject({ kind: 'compared' });
    expect(
      result.kind === 'compared' && result.regressions.map((r) => r.metric),
    ).toEqual(['hitAt5', 'groundedness']);
    expect(describeGate(result, 5).failed).toBe(true);
  });

  it('never gates a --only run, even with a baseline and a regression', () => {
    const result = evaluateGate(
      input({
        subset: true,
        current: {
          provider: 'other',
          model: 'other',
          metrics: { ...metrics, hitAt5: 0 },
        },
      }),
    );
    expect(describeGate(result, 5)).toEqual({
      message: 'Subset run: regression gate skipped',
      failed: false,
    });
  });

  it('refuses to compare across providers or models', () => {
    for (const current of [
      { provider: 'openai-compatible', model: 'claude-haiku-5-5' },
      { provider: 'claude', model: 'claude-opus-5-5' },
    ]) {
      const report = describeGate(
        evaluateGate(input({ current: { ...current, metrics } })),
        5,
      );
      expect(report.failed).toBe(true);
      expect(report.message).toContain('--allow-model-mismatch');
      expect(report.message).toContain('claude / claude-haiku-5-5');
    }
  });

  it('compares across models, with a warning, when allowed', () => {
    const report = describeGate(
      evaluateGate(
        input({
          allowModelMismatch: true,
          current: { provider: 'claude', model: 'claude-opus-5-5', metrics },
        }),
      ),
      5,
    );
    expect(report.failed).toBe(false);
    expect(report.message).toContain('Comparing across models');
  });

  it('exits 0 locally and fails in CI when there is no baseline', () => {
    const local = describeGate(evaluateGate(input({ baseline: null })), 5);
    expect(local.failed).toBe(false);
    expect(local.message).toBe(
      'No baseline yet — run with --update-baseline and commit apps/api/evals/baseline.json',
    );
    const ci = describeGate(
      evaluateGate(input({ baseline: null, ci: true })),
      5,
    );
    expect(ci.failed).toBe(true);
  });
});

describe('decideBaselineUpdate', () => {
  const clean = evaluateGate(input());
  const regressed = evaluateGate(
    input({
      current: {
        provider: 'claude',
        model: 'claude-haiku-5-5',
        metrics: { ...metrics, hitAt5: 0.5 },
      },
    }),
  );

  it('writes when every case passes and the gate passes', () => {
    expect(decideBaselineUpdate({ failedCases: [], gate: clean })).toEqual({
      write: true,
    });
  });

  it('refuses when a case failed, naming it', () => {
    const decision = decideBaselineUpdate({
      failedCases: ['case-a'],
      gate: clean,
    });
    expect(decision).toMatchObject({ write: false });
    expect(!decision.write && decision.reasons.join(' ')).toContain('case-a');
  });

  it('refuses when the gate reports a regression', () => {
    const decision = decideBaselineUpdate({ failedCases: [], gate: regressed });
    expect(decision).toMatchObject({ write: false });
    expect(!decision.write && decision.reasons.join(' ')).toContain('hitAt5');
  });

  it('reports both reasons together', () => {
    const decision = decideBaselineUpdate({
      failedCases: ['case-a'],
      gate: regressed,
    });
    expect(!decision.write && decision.reasons).toHaveLength(2);
  });

  it('allows a first baseline and a re-record for another model', () => {
    expect(
      decideBaselineUpdate({
        failedCases: [],
        gate: evaluateGate(input({ baseline: null })),
      }),
    ).toEqual({ write: true });
    expect(
      decideBaselineUpdate({
        failedCases: [],
        gate: evaluateGate(
          input({
            current: { provider: 'openai-compatible', model: 'x', metrics },
          }),
        ),
      }),
    ).toEqual({ write: true });
  });
});
