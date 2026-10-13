import { renderTable } from '../scripts/format-table.js';
import type {
  CaseScore,
  Expectation,
  Metrics,
  Observation,
  RatioMetric,
  Regression,
} from './scoring.js';
import { RATIO_METRICS } from './scoring.js';

export interface CaseResult {
  id: string;
  turns: string[];
  expect: Expectation;
  /** `null` when the case crashed (see `error`). */
  observed: Observation | null;
  score: CaseScore;
  error?: string | undefined;
  /** 2 when the case was rerun after a rate-limit response. */
  attempts: number;
}

const METRIC_LABEL: Record<RatioMetric, string> = {
  intentAccuracy: 'Intent accuracy',
  filterAccuracy: 'Filter accuracy (fields)',
  hitAt5: 'Retrieval hit@5',
  exclusion: 'Exclusion',
  referenceAccuracy: 'Reference accuracy',
  groundedness: 'Groundedness',
  refusalCorrectness: 'Refusal correctness',
};

function mark(value: boolean | null): string {
  if (value === null) return '-';
  return value ? 'ok' : 'FAIL';
}

function percent(value: number | null): string {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function renderCaseTable(results: readonly CaseResult[]): string {
  return renderTable(
    [
      { header: 'Case' },
      { header: 'Intent' },
      { header: 'Filters' },
      { header: 'Hit@5' },
      { header: 'Excl.' },
      { header: 'Ref.' },
      { header: 'Ground.' },
      { header: 'Refusal' },
      { header: 'Latency (all turns)', align: 'right' },
      { header: 'Tokens (all turns)', align: 'right' },
    ],
    results.map(({ id, score, observed, error }) => [
      error ? `${id} (error)` : id,
      mark(score.intent),
      score.filters ? `${score.filters.matched}/${score.filters.total}` : '-',
      mark(score.hit),
      mark(score.exclusion),
      mark(score.reference),
      mark(score.grounded),
      mark(score.refusal),
      observed ? seconds(observed.conversationLatencyMs) : '-',
      observed
        ? String(
            observed.conversationInputTokens +
              observed.conversationOutputTokens,
          )
        : '-',
    ]),
  );
}

/** One line per thing that went wrong in a case, for the log. */
export function describeFailures(result: CaseResult): string[] {
  const { id, score, observed, expect, error } = result;
  if (error) return [`${id}: crashed: ${error}`];
  const lines: string[] = [];
  if (!score.intent) {
    lines.push(
      `${id}: intent expected "${expect.intent}", got "${observed?.intent ?? 'none'}"`,
    );
  }
  if (score.filters && observed && observed.filters === null) {
    lines.push(
      `${id}: filters expected, but the last turn was "${observed.intent ?? 'none'}", not a search`,
    );
  }
  for (const m of score.filters?.mismatches ?? []) {
    lines.push(
      `${id}: filter ${m.field} expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.actual) ?? 'unset'}`,
    );
  }
  const retrievedSlugs = observed?.retrievedSlugs ?? null;
  const retrieved =
    retrievedSlugs === null
      ? '(no search this turn)'
      : `[${retrievedSlugs.join(', ')}]`;
  if (score.hit === false) {
    lines.push(
      `${id}: none of [${(expect.anyOfSlugs ?? []).join(', ')}] in results ${retrieved}`,
    );
  }
  if (score.exclusion === false) {
    const present = (expect.noneOfSlugs ?? []).filter((slug) =>
      retrievedSlugs?.includes(slug),
    );
    if (retrievedSlugs === null) {
      lines.push(
        `${id}: exclusion expected, but there was no search this turn`,
      );
    } else if (present.length > 0) {
      lines.push(`${id}: excluded listing(s) returned: ${present.join(', ')}`);
    } else {
      lines.push(`${id}: no listing expected, got ${retrieved}`);
    }
  }
  if (score.reference === false) {
    lines.push(
      `${id}: reference expected one of [${(expect.focusSlug ?? []).join(', ')}], resolved to ${observed?.focusSlug ?? 'nothing'}`,
    );
  }
  if (score.grounded === false) {
    const allowed = new Set(observed?.groundingSlugs);
    const stray = (observed?.citations ?? []).filter((s) => !allowed.has(s));
    lines.push(
      `${id}: citation(s) outside the retrieved listings: ${stray.join(', ')}`,
    );
  }
  if (!score.refusal) {
    const wrongLanguage =
      observed !== null &&
      observed.refused === (expect.expectRefusal ?? false) &&
      expect.replyLanguage !== undefined;
    lines.push(
      wrongLanguage
        ? `${id}: reply expected in "${expect.replyLanguage}", got "${observed.reply.slice(0, 80)}"`
        : `${id}: refusal expected ${expect.expectRefusal ?? false}, got ${observed?.refused ?? 'none'}`,
    );
  }
  return lines;
}

export function renderMetricsTable(
  metrics: Metrics,
  baseline: Metrics | null,
  regressions: readonly Regression[],
): string {
  const regressed = new Set(regressions.map(({ metric }) => metric));
  const rows = RATIO_METRICS.map((metric) => {
    const before = baseline?.[metric] ?? null;
    const now = metrics[metric];
    const delta =
      before !== null && now !== null
        ? `${now - before >= 0 ? '+' : ''}${((now - before) * 100).toFixed(1)} pt`
        : '-';
    return [
      METRIC_LABEL[metric],
      percent(now),
      baseline ? percent(before) : '-',
      delta,
      regressed.has(metric) ? 'REGRESSION' : '',
    ];
  });
  rows.push([
    'Avg conversation latency (all turns)',
    metrics.avgConversationLatencyMs === null
      ? 'n/a'
      : seconds(metrics.avgConversationLatencyMs),
    baseline?.avgConversationLatencyMs == null
      ? '-'
      : seconds(baseline.avgConversationLatencyMs),
    '',
    '',
  ]);
  rows.push([
    'Total tokens (all turns)',
    metrics.totalTokens === null ? 'n/a' : String(metrics.totalTokens),
    baseline?.totalTokens == null ? '-' : String(baseline.totalTokens),
    '',
    '',
  ]);
  return renderTable(
    [
      { header: 'Metric' },
      { header: 'Now', align: 'right' },
      { header: 'Baseline', align: 'right' },
      { header: 'Delta', align: 'right' },
      { header: 'Gate' },
    ],
    rows,
  );
}
