import { describe, expect, it } from 'vitest';
import { detailsGroundingSlugs, searchGroundingSlugs } from './grounding.js';

describe('grounding sets', () => {
  it('lets a search answer cite the retrieved listings only', () => {
    expect(
      searchGroundingSlugs([{ slug: 'a-one' }, { slug: 'b-two' }]),
    ).toEqual(new Set(['a-one', 'b-two']));
    expect(searchGroundingSlugs([])).toEqual(new Set());
  });

  it('lets a details answer cite the detail card only', () => {
    expect(detailsGroundingSlugs('a-one')).toEqual(new Set(['a-one']));
  });
});
