import { describe, expect, it } from 'vitest';
import { propertyFrontmatterSchema } from './property-frontmatter.schema.js';

const valid = {
  slug: 'new-cairo-apartment-3br',
  title: 'Three-bedroom apartment in New Cairo',
  type: 'apartment',
  listing: 'SALE',
  price: 6_500_000,
  bedrooms: 3,
  bathrooms: 2,
  areaM2: 165,
  city: 'New Cairo',
};

describe('propertyFrontmatterSchema', () => {
  it('accepts a minimal valid listing and applies the EGP default', () => {
    const parsed = propertyFrontmatterSchema.parse(valid);
    expect(parsed.currency).toBe('EGP');
    expect(parsed.compound).toBeUndefined();
  });

  it('coerces delivery dates and keeps optional text fields', () => {
    const parsed = propertyFrontmatterSchema.parse({
      ...valid,
      deliveryDate: '2028-06-30',
      compound: 'Mountain View iCity',
      finishing: 'fully finished',
    });
    expect(parsed.deliveryDate).toEqual(new Date('2028-06-30'));
    expect(parsed.compound).toBe('Mountain View iCity');
  });

  it('accepts a YAML date (a Date object) as the delivery date', () => {
    const parsed = propertyFrontmatterSchema.parse({
      ...valid,
      deliveryDate: new Date('2027-06-30T00:00:00.000Z'),
    });
    expect(parsed.deliveryDate).toEqual(new Date('2027-06-30T00:00:00.000Z'));
  });

  it.each([
    ['a bare year (YAML number)', 2027],
    ['a timestamp number', 1_800_000_000],
    ['a year-month string', '2027-06'],
    ['free text', 'Q3 2027'],
    ['a US-style date', '06/30/2027'],
    ['an impossible calendar date', '2027-02-30'],
    ['a boolean', true],
    ['an invalid Date', new Date('nope')],
  ])('rejects %s as the delivery date', (_label, deliveryDate) => {
    const result = propertyFrontmatterSchema.safeParse({
      ...valid,
      deliveryDate,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toEqual([
        'deliveryDate must be a date like 2027-06-30',
      ]);
    }
  });

  it('rejects non-positive prices, fractional bedrooms and unknown types with precise paths', () => {
    const result = propertyFrontmatterSchema.safeParse({
      ...valid,
      price: 0,
      bedrooms: 2.5,
      type: 'castle',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues
        .map((issue) => issue.path.join('.'))
        .sort();
      expect(paths).toEqual(['bedrooms', 'price', 'type']);
    }
  });

  it('rejects unknown keys so typos are surfaced to the admin', () => {
    const result = propertyFrontmatterSchema.safeParse({
      ...valid,
      bedroom: 3,
    });
    expect(result.success).toBe(false);
  });
});
