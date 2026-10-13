import { describe, expect, it } from 'vitest';
import {
  ordinalIndexFromMessage,
  resolveCandidate,
  resolveOrdinalFromMessage,
} from './listing-reference.js';

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

describe('resolveCandidate with ordinal-looking words', () => {
  it.each([
    'book it for the 2nd of November',
    'my last name is Hassan',
    'what is the first installment?',
    'يوم اول الشهر',
    'عايز ميعاد تاني',
  ])('does not read %j as a listing position', (reference) => {
    expect(resolveCandidate(reference, candidates)).toBeUndefined();
  });

  it.each([
    ['tell me about the 2nd listing', 'zamalek-apartment-rent'],
    ['number 3', 'october-office-rent'],
    ['#2', 'zamalek-apartment-rent'],
    ['رقم 2', 'zamalek-apartment-rent'],
    ['2', 'zamalek-apartment-rent'],
  ])('still resolves %j', (reference, slug) => {
    expect(resolveCandidate(reference, candidates)?.slug).toBe(slug);
  });
});

describe('ordinalIndexFromMessage', () => {
  it.each([
    ['the first one', 5, 0],
    ['tell me more about the second one', 5, 1],
    ['what about the 3rd?', 5, 2],
    ['the fourth one please', 5, 3],
    ['i like the fifth one', 5, 4],
    ['the last one', 4, 3],
    ['the last one', 1, 0],
    ['number 2', 5, 1],
    ['option 3', 5, 2],
    ['#4', 5, 3],
    ['Second one!', 5, 1],
    ['الاول', 5, 0],
    ['الأولى', 5, 0],
    ['the second', 5, 1],
    ['second one?', 5, 1],
    ['tell me about the 2nd listing', 5, 1],
    ['the third apartment', 5, 2],
    ['what about the 3rd?', 5, 2],
    ['#2', 5, 1],
    ['the last one', 5, 4],
    ['التاني', 5, 1],
    ['التانية', 5, 1],
    ['الثانية؟', 5, 1],
    ['عايز اعرف عن التانيه', 5, 1],
    ['التالت', 5, 2],
    ['الثالثة', 5, 2],
    ['الرابعة', 5, 3],
    ['الرابع', 5, 3],
    ['الخامسة', 5, 4],
    ['الأخيرة', 3, 2],
    ['الاخير', 3, 2],
    ['رقم ٢', 5, 1],
    ['رقم 3', 5, 2],
    ['وبالنسبة للتاني؟', 5, 1],
  ])('"%s" among %i listings is index %i', (text, count, index) => {
    expect(ordinalIndexFromMessage(text, count)).toBe(index);
  });

  it.each([
    ['tell me more about it', 5],
    ['what is the payment plan?', 5],
    ['my phone number is 01001234567', 5],
    ['رقم 01001234567', 5],
    ['اولاد', 5],
    ['the first and the second one', 5],
    // The ordinal is a date, a name, a period or a part of something else.
    ['book it for the 2nd of November', 5],
    ['book it for the 2nd', 5],
    ['it is on the 3rd of next month', 5],
    ['my last name is Hassan', 5],
    ['what is the first installment?', 5],
    ['the second floor', 5],
    ['I need it in the first week', 5],
    ['the first payment is high', 5],
    ['يوم اول الشهر', 5],
    ['اول الشهر', 5],
    ['عايز ميعاد تاني', 5],
    ['تاني', 5],
    ['التاني من نوفمبر', 5],
    ['القسط الاول', 5],
    ['الدور التاني', 5],
    ['القسط التاني كام', 5],
    ['اول واحدة', 5],
    ['my apartment number 5 is on the 2nd floor', 5],
    ['phone number 2', 5],
    ['2', 5],
    ['the fifth one', 3],
    ['number 4', 3],
    ['the second one', 0],
    ['', 3],
  ])('"%s" among %i listings names none', (text, count) => {
    expect(ordinalIndexFromMessage(text, count)).toBeUndefined();
  });
});

describe('resolveOrdinalFromMessage', () => {
  it('returns the listing at that position of the list shown', () => {
    expect(
      resolveOrdinalFromMessage('and the third one?', candidates)?.slug,
    ).toBe('october-office-rent');
    expect(
      resolveOrdinalFromMessage('التاني', candidates)?.slug,
    ).toBe('zamalek-apartment-rent');
  });

  it('returns nothing when the list is empty', () => {
    expect(resolveOrdinalFromMessage('the first one', [])).toBeUndefined();
  });
});
