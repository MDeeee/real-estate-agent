import { describe, expect, it } from 'vitest';
import { resolveCandidate } from './listing-reference.js';

const candidates = [
  { slug: 'new-cairo-villa-sale', title: 'Corner villa in Laurel Hills' },
  {
    slug: 'zamalek-apartment-rent',
    title: 'Furnished flat on the Nile in Zamalek',
  },
  { slug: 'october-office-rent', title: 'Open-plan office in 6th of October' },
];

describe('resolveCandidate', () => {
  it.each([
    ['the second one', 'zamalek-apartment-rent'],
    ['2nd', 'zamalek-apartment-rent'],
    ['option 3', 'october-office-rent'],
    ['#1', 'new-cairo-villa-sale'],
    ['the last one', 'october-office-rent'],
    ['التانية', 'zamalek-apartment-rent'],
    ['الثالثة', 'october-office-rent'],
    ['الأولى', 'new-cairo-villa-sale'],
    ['رقم ٢', 'zamalek-apartment-rent'],
  ])('resolves the ordinal %j', (reference, slug) => {
    expect(resolveCandidate(reference, candidates)?.slug).toBe(slug);
  });

  it('resolves an exact slug, also inside a sentence', () => {
    expect(resolveCandidate('october-office-rent', candidates)?.slug).toBe(
      'october-office-rent',
    );
    expect(
      resolveCandidate('the one called zamalek-apartment-rent', candidates)
        ?.slug,
    ).toBe('zamalek-apartment-rent');
  });

  it('resolves by title words when unambiguous', () => {
    expect(resolveCandidate('the villa at Laurel', candidates)?.slug).toBe(
      'new-cairo-villa-sale',
    );
    expect(resolveCandidate('Zamalek flat', candidates)?.slug).toBe(
      'zamalek-apartment-rent',
    );
  });

  it('returns undefined for ties, out-of-range ordinals and unknown words', () => {
    expect(
      resolveCandidate('the office in Laurel', candidates),
    ).toBeUndefined();
    expect(resolveCandidate('the fifth one', candidates)).toBeUndefined();
    expect(resolveCandidate('chalet by the sea', candidates)).toBeUndefined();
    expect(resolveCandidate(undefined, candidates)).toBeUndefined();
    expect(resolveCandidate('first', [])).toBeUndefined();
  });

  it('does not read "3 bedroom" as the third listing', () => {
    expect(resolveCandidate('3 bedroom villa', candidates)?.slug).toBe(
      'new-cairo-villa-sale',
    );
  });
});
