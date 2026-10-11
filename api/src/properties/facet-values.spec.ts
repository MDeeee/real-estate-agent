import { describe, expect, it } from 'vitest';
import { mergeFacetValues } from './facet-values.js';

describe('mergeFacetValues', () => {
  it('merges case and whitespace variants, summing counts', () => {
    expect(
      mergeFacetValues([
        { value: 'New Cairo', count: 3 },
        { value: 'new cairo', count: 1 },
        { value: ' NEW CAIRO ', count: 1 },
        { value: 'Zamalek', count: 2 },
      ]),
    ).toEqual([
      { value: 'New Cairo', count: 5 },
      { value: 'Zamalek', count: 2 },
    ]);
  });

  it('displays the most frequent spelling, proper case on a tie', () => {
    expect(
      mergeFacetValues([
        { value: 'sheikh zayed', count: 4 },
        { value: 'Sheikh Zayed', count: 1 },
      ]),
    ).toEqual([{ value: 'sheikh zayed', count: 5 }]);
    expect(
      mergeFacetValues([
        { value: 'b hills', count: 2 },
        { value: 'B Hills', count: 2 },
      ]),
    ).toEqual([{ value: 'B Hills', count: 4 }]);
  });

  it('drops blank values', () => {
    expect(mergeFacetValues([{ value: '  ', count: 2 }])).toEqual([]);
  });
});
