import { describe, expect, it } from 'vitest';
import type { IngestResult } from '../src/ingestion/ingestion.types.js';
import { renderSeedReport, seedExitCode, summarise } from './seed-report.js';

const created: IngestResult = {
  filename: 'a.md',
  outcome: 'created',
  propertySlug: 'a-flat',
  chunks: 3,
};
const unchanged: IngestResult = {
  filename: 'b.md',
  outcome: 'unchanged',
  propertySlug: 'b-flat',
  chunks: 2,
};
const failed: IngestResult = {
  filename: 'c.md',
  outcome: 'failed',
  error: 'Embedding service unavailable: down',
};

describe('seed report', () => {
  it('counts each outcome', () => {
    expect(summarise([created, unchanged, unchanged, failed])).toEqual({
      created: 1,
      updated: 0,
      unchanged: 2,
      failed: 1,
      conflict: 0,
    });
  });

  it('exits non-zero only when a file failed', () => {
    expect(seedExitCode([created, unchanged])).toBe(0);
    expect(seedExitCode([created, failed])).toBe(1);
    expect(seedExitCode([])).toBe(0);
  });

  it('shows the slug for good files, the error for failed ones and a summary', () => {
    const report = renderSeedReport([created, failed]);
    expect(report).toContain('a-flat');
    expect(report).toContain('Embedding service unavailable: down');
    expect(report).toContain(
      '2 file(s): 1 created, 0 updated, 0 unchanged, 1 failed',
    );
  });
});
