import { describe, expect, it } from 'vitest';
import { toLatinDigits } from './digits.js';
import { resolveCandidate } from './listing-reference.js';
import { normalisePhone } from './booking-validation.js';

describe('toLatinDigits', () => {
  it('converts Arabic-Indic and Eastern Arabic-Indic digits only', () => {
    expect(toLatinDigits('٠١٢٣٤٥٦٧٨٩ ۰۱۲۳۴۵۶۷۸۹ abc 42')).toBe(
      '0123456789 0123456789 abc 42',
    );
  });

  it('is the one conversion behind phone numbers and listing numbers', () => {
    expect(normalisePhone('٠١٠٠١٢٣٤٥٦٧')).toBe('01001234567');
    expect(normalisePhone('۰۱۰۰۱۲۳۴۵۶۷')).toBe('01001234567');
    const candidates = [
      { slug: 'a-one', title: 'Alpha place' },
      { slug: 'b-two', title: 'Beta place' },
    ];
    expect(resolveCandidate('رقم ٢', candidates)?.slug).toBe('b-two');
    expect(resolveCandidate('رقم ۲', candidates)?.slug).toBe('b-two');
  });
});
