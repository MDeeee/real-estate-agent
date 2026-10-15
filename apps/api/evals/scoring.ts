import { detectLanguage } from '../src/agent/language.js';
import type { Intent, Language } from '../src/llm/agent-model.js';
import type { PropertyFilters } from '../src/properties/property-filters.schema.js';

/** What a case expects of the LAST turn of its conversation. */
export interface Expectation {
  intent: Intent;
  /** Subset of the extracted filters that must match exactly. */
  filters?: Partial<PropertyFilters> | undefined;
  /** At least one of these must be among the returned top results. */
  anyOfSlugs?: readonly string[] | undefined;
  /** None of these may be among the returned top results. */
  noneOfSlugs?: readonly string[] | undefined;
  /**
   * `details` turns: the listing the agent must resolve the reference to. Any
   * of these counts (use several when the earlier ranking is not deterministic).
   */
  focusSlug?: readonly string[] | undefined;
  /** Search turns: filter keys that must NOT be set (a type invented for a generic request). */
  absentFilters?: readonly (keyof PropertyFilters)[] | undefined;
  /** `details` turns: no listing may be resolved (a position beyond the listings shown). */
  expectNoFocus?: boolean | undefined;
  /** The reply must be the standard refusal (and only then). Default false. */
  expectRefusal?: boolean | undefined;
  /**
   * Search turns: the search must return no listing at all (the data has no
   * match, and the agent must not pad the result). Scored as part of
   * `exclusion`.
   */
  expectNoHits?: boolean | undefined;
  /** The language of the final reply (script-based, as production detects it). */
  replyLanguage?: Language | undefined;
}

/**
 * What the agent actually did on the last turn of a case. A field is `null`
 * when the last turn's intent does not produce it (state left over from earlier
 * turns is never reported), and an expectation on it then fails.
 */
export interface Observation {
  intent: Intent | null;
  /** Search turns: the filters extracted this turn. */
  filters: PropertyFilters | null;
  /** Search turns: listings returned this turn, best first. */
  retrievedSlugs: readonly string[] | null;
  /** Details turns: the listing the reference resolved to; book turns: the listing the booking draft points at. */
  focusSlug: string | null;
  /** Every slug the answer may cite without being ungrounded (production's set). */
  groundingSlugs: readonly string[];
  /** `[slug]` citations in the model's raw answer, before the post-check. */
  citations: readonly string[];
  /** Whether the model streamed a free-form answer this turn. */
  hasAnswer: boolean;
  refused: boolean;
  /** The text of the final assistant reply. */
  reply: string;
  /** Wall time of ALL turns of the conversation, rate-limit pauses excluded. */
  conversationLatencyMs: number;
  /** Input tokens summed over ALL turns of the conversation. */
  conversationInputTokens: number;
  /** Output tokens summed over ALL turns of the conversation. */
  conversationOutputTokens: number;
}

export interface FilterMismatch {
  field: string;
  expected: unknown;
  actual: unknown;
}

export interface FilterScore {
  matched: number;
  total: number;
  mismatches: FilterMismatch[];
}

/** `null` means the case does not test that aspect. */
export interface CaseScore {
  intent: boolean;
  filters: FilterScore | null;
  hit: boolean | null;
  exclusion: boolean | null;
  reference: boolean | null;
  grounded: boolean | null;
  refusal: boolean;
}

export const TOP_K = 5;

function sameValue(expected: unknown, actual: unknown): boolean {
  if (typeof expected === 'string' && typeof actual === 'string') {
    return expected.trim().toLowerCase() === actual.trim().toLowerCase();
  }
  return expected === actual;
}

function definedEntries(
  filters: Partial<PropertyFilters>,
): [string, unknown][] {
  return Object.entries(filters).filter(([, value]) => value !== undefined);
}

/**
 * Field-level comparison over the expected fields only: extra filters the
 * model added are not penalised here (the retrieval metrics catch the harm).
 * Text is compared case-insensitively, as the search itself does.
 */
export function scoreFilters(
  expected: Partial<PropertyFilters>,
  actual: PropertyFilters,
): FilterScore {
  const actualByField: Record<string, unknown> = { ...actual };
  const entries = definedEntries(expected);
  const mismatches: FilterMismatch[] = [];
  for (const [field, value] of entries) {
    if (!sameValue(value, actualByField[field])) {
      mismatches.push({ field, expected: value, actual: actualByField[field] });
    }
  }
  return {
    matched: entries.length - mismatches.length,
    total: entries.length,
    mismatches,
  };
}

/**
 * Scores one case. `observed` is `null` when the case crashed: every aspect
 * the case tests then counts as failed, so an outage cannot look like success.
 */
export function scoreCase(
  expected: Expectation,
  observed: Observation | null,
): CaseScore {
  const top = observed?.retrievedSlugs?.slice(0, TOP_K) ?? null;
  const wantAny = expected.anyOfSlugs ?? [];
  const wantNone = expected.noneOfSlugs ?? [];
  const wantFocus = expected.focusSlug ?? [];
  const wantNoHits = expected.expectNoHits ?? false;
  const wantedFilters = expected.filters ?? {};
  const wantAbsent = expected.absentFilters ?? [];
  const wantedCount = definedEntries(wantedFilters).length;

  let filters: FilterScore | null = null;
  if (wantedCount + wantAbsent.length > 0) {
    if (observed?.filters) {
      const base = scoreFilters(wantedFilters, observed.filters);
      const present = wantAbsent.filter(
        (key) => observed.filters?.[key] !== undefined,
      );
      filters = {
        matched: base.matched + wantAbsent.length - present.length,
        total: base.total + wantAbsent.length,
        mismatches: [
          ...base.mismatches,
          ...present.map((key) => ({
            field: key,
            expected: undefined,
            actual: observed.filters?.[key],
          })),
        ],
      };
    } else {
      filters = {
        matched: 0,
        total: wantedCount + wantAbsent.length,
        mismatches: [],
      };
    }
  }

  let grounded: boolean | null = null;
  if (observed?.hasAnswer) {
    const allowed = new Set(observed.groundingSlugs);
    grounded = observed.citations.every((slug) => allowed.has(slug));
  }

  return {
    intent: observed !== null && observed.intent === expected.intent,
    filters,
    hit:
      wantAny.length === 0
        ? null
        : top !== null && wantAny.some((slug) => top.includes(slug)),
    exclusion:
      wantNone.length === 0 && !wantNoHits
        ? null
        : top !== null &&
          !wantNone.some((slug) => top.includes(slug)) &&
          (!wantNoHits || top.length === 0),
    reference: expected.expectNoFocus
      ? observed !== null && observed.focusSlug === null
      : wantFocus.length === 0
        ? null
        : observed?.focusSlug != null && wantFocus.includes(observed.focusSlug),
    grounded,
    // The reply's shape: a refusal exactly when expected, and in the expected
    // language when the case states one.
    refusal:
      observed !== null &&
      observed.refused === (expected.expectRefusal ?? false) &&
      (expected.replyLanguage === undefined ||
        detectLanguage(observed.reply) === expected.replyLanguage),
  };
}

export const RATIO_METRICS = [
  'intentAccuracy',
  'filterAccuracy',
  'hitAt5',
  'exclusion',
  'referenceAccuracy',
  'groundedness',
  'refusalCorrectness',
] as const;

export type RatioMetric = (typeof RATIO_METRICS)[number];

export type Metrics = Record<RatioMetric, number | null> & {
  /** Mean over cases of the latency of the whole conversation. */
  avgConversationLatencyMs: number | null;
  /** Input plus output tokens over every turn of every case. */
  totalTokens: number | null;
};

export interface CaseOutcome {
  score: CaseScore;
  observed: Observation | null;
}

function ratio(passed: number, total: number): number | null {
  return total === 0 ? null : passed / total;
}

function ratioOf(values: readonly (boolean | null)[]): number | null {
  const tested = values.filter((value) => value !== null);
  return ratio(tested.filter(Boolean).length, tested.length);
}

export function aggregate(outcomes: readonly CaseOutcome[]): Metrics {
  const scores = outcomes.map(({ score }) => score);
  const filters = scores.flatMap(({ filters: f }) => (f ? [f] : []));
  const observed = outcomes.flatMap(({ observed: o }) => (o ? [o] : []));
  const tokens = observed.reduce(
    (sum, o) => sum + o.conversationInputTokens + o.conversationOutputTokens,
    0,
  );
  return {
    intentAccuracy: ratioOf(scores.map(({ intent }) => intent)),
    // Micro-average: every expected field weighs the same.
    filterAccuracy: ratio(
      filters.reduce((sum, f) => sum + f.matched, 0),
      filters.reduce((sum, f) => sum + f.total, 0),
    ),
    hitAt5: ratioOf(scores.map(({ hit }) => hit)),
    exclusion: ratioOf(scores.map(({ exclusion }) => exclusion)),
    referenceAccuracy: ratioOf(scores.map(({ reference }) => reference)),
    groundedness: ratioOf(scores.map(({ grounded }) => grounded)),
    refusalCorrectness: ratioOf(scores.map(({ refusal }) => refusal)),
    avgConversationLatencyMs:
      observed.length === 0
        ? null
        : observed.reduce((sum, o) => sum + o.conversationLatencyMs, 0) /
          observed.length,
    totalTokens: tokens > 0 ? tokens : null,
  };
}

export interface Regression {
  metric: RatioMetric;
  baseline: number;
  /** `null` when the metric could not be computed this run. */
  current: number | null;
  /** Points lost; the whole baseline value when `current` is `null`. */
  drop: number;
}

/**
 * Metrics that fell more than `tolerance` below the baseline, or that the
 * baseline measured and this run did not (a case or answer went missing, so
 * the metric must not pass silently). Latency and tokens vary by provider and
 * load, so only the quality ratios are gated. Call this for FULL runs only.
 */
export function findRegressions(
  current: Metrics,
  baseline: Metrics,
  tolerance: number,
): Regression[] {
  return RATIO_METRICS.flatMap((metric): Regression[] => {
    const before = baseline[metric];
    const now = current[metric];
    if (before === null) return [];
    if (now === null)
      return [{ metric, baseline: before, current: null, drop: before }];
    const drop = before - now;
    // The epsilon keeps a drop of exactly `tolerance` from failing on float noise.
    return drop > tolerance + 1e-9
      ? [{ metric, baseline: before, current: now, drop }]
      : [];
  });
}
