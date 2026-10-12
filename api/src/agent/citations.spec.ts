import { describe, expect, it } from 'vitest';
import { sanitiseCitations } from './citations.js';

const allowed = new Set(['zamalek-flat', 'laurel-villa']);

describe('sanitiseCitations', () => {
  it('keeps valid citations and reports each once, in order', () => {
    const result = sanitiseCitations(
      'Try [laurel-villa] or [zamalek-flat]; [laurel-villa] is bigger.',
      allowed,
    );
    expect(result.citedSlugs).toEqual(['laurel-villa', 'zamalek-flat']);
    expect(result.dropped).toEqual([]);
    expect(result.text).toBe(
      'Try [laurel-villa] or [zamalek-flat]; [laurel-villa] is bigger.',
    );
  });

  it('removes citations that are not in the allowed set', () => {
    const result = sanitiseCitations(
      'See [zamalek-flat] and [invented-penthouse].',
      allowed,
    );
    expect(result.text).toBe('See [zamalek-flat] and.');
    expect(result.citedSlugs).toEqual(['zamalek-flat']);
    expect(result.dropped).toEqual(['invented-penthouse']);
  });

  it('leaves other bracketed text alone', () => {
    const result = sanitiseCitations('Floor [4] and [Note] stay.', allowed);
    expect(result.text).toBe('Floor [4] and [Note] stay.');
    expect(result.dropped).toEqual([]);
  });

  it('does not touch markdown links, even when the link text looks like a slug', () => {
    const text =
      'See [zamalek-flat](https://evil.example/x) and [docs](https://a.b) or [invented-penthouse](http://c.d).';
    const result = sanitiseCitations(text, allowed);
    expect(result.text).toBe(text);
    expect(result.citedSlugs).toEqual([]);
    expect(result.dropped).toEqual([]);
  });

  it('still treats a bare slug followed by a space and a bracket as a citation', () => {
    const result = sanitiseCitations('Try [zamalek-flat] (2 bedrooms).', allowed);
    expect(result.citedSlugs).toEqual(['zamalek-flat']);
    expect(result.text).toBe('Try [zamalek-flat] (2 bedrooms).');
  });

  it('handles text without citations', () => {
    expect(sanitiseCitations('Nothing here.', allowed)).toEqual({
      text: 'Nothing here.',
      citedSlugs: [],
      dropped: [],
    });
  });
});
