import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { propertyFiltersSchema } from './property-filters.schema.js';
import { propertySearchQuerySchema } from './property-search.schema.js';

describe('propertyFiltersSchema', () => {
  it('accepts an empty object', () => {
    expect(propertyFiltersSchema.parse({})).toEqual({});
  });

  it('coerces numeric query strings and trims text', () => {
    expect(
      propertyFiltersSchema.parse({
        city: '  New Cairo ',
        listing: 'SALE',
        type: 'villa',
        priceMin: '1000000',
        priceMax: '5000000.5',
        bedroomsMin: '3',
        areaMin: '120',
      }),
    ).toEqual({
      city: 'New Cairo',
      listing: 'SALE',
      type: 'villa',
      priceMin: 1_000_000,
      priceMax: 5_000_000.5,
      bedroomsMin: 3,
      areaMin: 120,
    });
  });

  it.each([
    ['negative price', { priceMin: '-1' }],
    ['non-numeric price', { priceMax: 'cheap' }],
    ['fractional bedrooms', { bedroomsMin: '2.5' }],
    ['unknown type', { type: 'castle' }],
    ['lowercase listing', { listing: 'sale' }],
    ['blank city', { city: '   ' }],
  ])('rejects %s', (_label, input) => {
    expect(propertyFiltersSchema.safeParse(input).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    const result = propertyFiltersSchema.safeParse({ colour: 'blue' });
    expect(result.success).toBe(false);
  });

  it('rejects inverted ranges with a readable message', () => {
    const price = propertyFiltersSchema.safeParse({
      priceMin: 5_000_000,
      priceMax: 1000,
    });
    expect(price.success).toBe(false);
    if (!price.success) {
      expect(z.prettifyError(price.error)).toContain(
        'priceMin must not be greater than priceMax',
      );
    }
    expect(
      propertyFiltersSchema.safeParse({ areaMin: 200, areaMax: 100 }).success,
    ).toBe(false);
  });

  it('allows equal bounds', () => {
    expect(
      propertyFiltersSchema.safeParse({ priceMin: 100, priceMax: 100 }).success,
    ).toBe(true);
  });

  it('documents every field for structured output', () => {
    const schema = z.toJSONSchema(propertyFiltersSchema) as {
      properties: Record<string, { description?: string }>;
    };
    for (const [name, property] of Object.entries(schema.properties)) {
      expect(property.description, name).toBeTruthy();
    }
  });
});

describe('propertySearchQuerySchema', () => {
  it('applies sort and paging defaults', () => {
    expect(propertySearchQuerySchema.parse({})).toEqual({
      sort: 'newest',
      page: 1,
      pageSize: 12,
    });
  });

  it('enforces the page size cap and sort values', () => {
    expect(
      propertySearchQuerySchema.safeParse({ pageSize: '51' }).success,
    ).toBe(false);
    expect(
      propertySearchQuerySchema.safeParse({ pageSize: '50' }).success,
    ).toBe(true);
    expect(
      propertySearchQuerySchema.safeParse({ sort: 'cheapest' }).success,
    ).toBe(false);
  });

  it('still checks ranges alongside paging', () => {
    expect(
      propertySearchQuerySchema.safeParse({ areaMin: '9', areaMax: '1' })
        .success,
    ).toBe(false);
  });
});
