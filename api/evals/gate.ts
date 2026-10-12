import type { Baseline } from './baseline.js';
import { type Metrics, type Regression, findRegressions } from './scoring.js';

export interface GateInput {
  baseline: Baseline | null;
  current: { provider: string; model: string; metrics: Metrics };
  tolerance: number;
  /** `--only` run: a handful of cases cannot be compared with a full baseline. */
  subset: boolean;
  ci: boolean;
  allowModelMismatch: boolean;
}

export type GateResult =
  | { kind: 'subset' }
  | { kind: 'no-baseline'; ci: boolean }
  | {
      kind: 'model-mismatch';
      baseline: { provider: string; model: string };
      current: { provider: string; model: string };
    }
  | {
      kind: 'compared';
      regressions: Regression[];
      /** Set when the comparison runs across models on request. */
      mismatchWarning: string | null;
    };

function modelLabel({
  provider,
  model,
}: {
  provider: string;
  model: string;
}): string {
  return `${provider} / ${model}`;
}

/** Decides what the regression gate does with a finished (non-updating) run. */
export function evaluateGate(input: GateInput): GateResult {
  const { baseline, current } = input;
  if (input.subset) return { kind: 'subset' };
  if (!baseline) return { kind: 'no-baseline', ci: input.ci };

  const sameModel =
    baseline.provider === current.provider && baseline.model === current.model;
  if (!sameModel && !input.allowModelMismatch) {
    return {
      kind: 'model-mismatch',
      baseline: { provider: baseline.provider, model: baseline.model },
      current: { provider: current.provider, model: current.model },
    };
  }
  return {
    kind: 'compared',
    regressions: findRegressions(
      current.metrics,
      baseline.metrics,
      input.tolerance,
    ),
    mismatchWarning: sameModel
      ? null
      : `Comparing across models (baseline ${modelLabel(baseline)}, now ${modelLabel(current)}) because of --allow-model-mismatch.`,
  };
}

export interface GateReport {
  /** Printed after the tables. */
  message: string;
  /** Whether the gate alone makes the run fail. */
  failed: boolean;
}

/** The regressions the metrics table should mark; none unless a comparison happened. */
export function gateRegressions(result: GateResult): Regression[] {
  return result.kind === 'compared' ? result.regressions : [];
}

export function describeGate(
  result: GateResult,
  tolerancePoints: number,
): GateReport {
  switch (result.kind) {
    case 'subset':
      return {
        message: 'Subset run: regression gate skipped',
        failed: false,
      };
    case 'no-baseline':
      return {
        message:
          'No baseline yet — run with --update-baseline and commit api/evals/baseline.json',
        failed: result.ci,
      };
    case 'model-mismatch':
      return {
        message: `Eval FAILED: the baseline was recorded with ${modelLabel(result.baseline)} but this run uses ${modelLabel(result.current)}, so the metrics are not comparable. Re-record with --update-baseline, or pass --allow-model-mismatch to compare anyway.`,
        failed: true,
      };
    case 'compared': {
      const warning = result.mismatchWarning
        ? `${result.mismatchWarning}\n`
        : '';
      return result.regressions.length > 0
        ? {
            message: `${warning}Eval FAILED: ${result.regressions.length} metric(s) fell more than ${tolerancePoints} points below the baseline (or could not be measured).`,
            failed: true,
          }
        : {
            message: `${warning}Eval passed: no metric fell more than ${tolerancePoints} points below the baseline.`,
            failed: false,
          };
    }
  }
}
