import { describe, expect, it } from 'vitest';
import { markdownExcerpt } from './markdown-excerpt.js';

describe('markdownExcerpt', () => {
  it('drops headings and strips inline markdown', () => {
    const markdown =
      '## Location\n\nA **bright** flat near the [Nile](https://example.com) with `parking`.\n\n- Balcony\n- Lift';
    expect(markdownExcerpt(markdown)).toBe(
      'A bright flat near the Nile with parking. Balcony Lift',
    );
  });

  it('truncates at a word boundary with an ellipsis', () => {
    const excerpt = markdownExcerpt('word '.repeat(100), 180);
    expect(excerpt.length).toBeLessThanOrEqual(181);
    expect(excerpt.endsWith('…')).toBe(true);
    expect(excerpt).not.toMatch(/wor…$/);
  });

  it('keeps Arabic text intact', () => {
    expect(markdownExcerpt('## الموقع\n\nشقة مشرقة.')).toBe('شقة مشرقة.');
  });

  it('returns an empty string for a heading-only body', () => {
    expect(markdownExcerpt('## Only a heading')).toBe('');
  });
});
