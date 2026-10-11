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
