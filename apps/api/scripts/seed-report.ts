import type {
  IngestOutcome,
  IngestResult,
} from '../src/ingestion/ingestion.types.js';
import { renderTable } from './format-table.js';

export type SeedTotals = Record<IngestOutcome, number>;

export function summarise(results: readonly IngestResult[]): SeedTotals {
  const totals: SeedTotals = {
    created: 0,
    updated: 0,
    unchanged: 0,
    failed: 0,
    conflict: 0,
  };
  for (const { outcome } of results) totals[outcome] += 1;
  return totals;
}

export function renderSeedReport(results: readonly IngestResult[]): string {
  const totals = summarise(results);
  const table = renderTable(
    [
      { header: 'File' },
      { header: 'Outcome' },
      { header: 'Chunks', align: 'right' },
      { header: 'Slug / error' },
    ],
    results.map((result) => [
      result.filename,
      result.outcome,
      result.chunks === undefined ? '-' : String(result.chunks),
      result.outcome === 'failed'
        ? (result.error ?? 'unknown error')
        : (result.propertySlug ?? ''),
    ]),
  );
  const summary = `${results.length} file(s): ${totals.created} created, ${totals.updated} updated, ${totals.unchanged} unchanged, ${totals.failed} failed`;
  return `${table}\n\n${summary}`;
}

/** Non-zero when any file failed, so CI and scripts notice. */
export function seedExitCode(results: readonly IngestResult[]): number {
  return results.some(({ outcome }) => outcome === 'failed') ? 1 : 0;
}
