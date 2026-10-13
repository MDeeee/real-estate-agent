import { describe, expect, it } from 'vitest';
import { parseArgs } from './args.js';

describe('parseArgs', () => {
  it('defaults to a full, gated run', () => {
    expect(parseArgs([])).toEqual({
      updateBaseline: false,
      only: null,
      allowModelMismatch: false,
    });
  });

  it('reads every flag and ignores the pnpm "--" separator', () => {
    expect(parseArgs(['--', '--only=a, b,', '--allow-model-mismatch'])).toEqual(
      {
        updateBaseline: false,
        only: ['a', 'b'],
        allowModelMismatch: true,
      },
    );
    expect(parseArgs(['--update-baseline']).updateBaseline).toBe(true);
  });

  it('rejects unknown arguments', () => {
    expect(() => parseArgs(['--bogus'])).toThrow(/Unknown argument/);
  });
});
