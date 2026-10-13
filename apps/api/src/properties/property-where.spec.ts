import { describe, expect, it } from 'vitest';
import { buildPropertyOrderBy, buildPropertyWhere } from './property-where.js';

const indexedOnly = { document: { status: 'INDEXED' } };

describe('buildPropertyWhere', () => {
  it('always restricts to indexed documents', () => {
    expect(buildPropertyWhere({})).toEqual(indexedOnly);
  });

  it('matches city and district exactly but case-insensitively', () => {
    expect(
      buildPropertyWhere({ city: 'new cairo', district: 'Golden Square' }),
    ).toEqual({
      ...indexedOnly,
      city: { equals: 'new cairo', mode: 'insensitive' },
      district: { equals: 'Golden Square', mode: 'insensitive' },
    });
  });

  it('matches compound by case-insensitive substring', () => {
    expect(buildPropertyWhere({ compound: 'laurel' })).toEqual({
      ...indexedOnly,
      compound: { contains: 'laurel', mode: 'insensitive' },
    });
  });

  it('builds open and closed ranges', () => {
    expect(
      buildPropertyWhere({ priceMin: 10, priceMax: 20, areaMin: 50 }),
    ).toEqual({
      ...indexedOnly,
      price: { gte: 10, lte: 20 },
      areaM2: { gte: 50 },
    });
  });

  it('keeps zero as a real bound', () => {
    expect(buildPropertyWhere({ bedroomsMin: 0, priceMin: 0 })).toEqual({
      ...indexedOnly,
      bedrooms: { gte: 0 },
      price: { gte: 0 },
    });
  });

  it('maps type, listing and bathrooms', () => {
    expect(
      buildPropertyWhere({ type: 'villa', listing: 'RENT', bathroomsMin: 2 }),
    ).toEqual({
      ...indexedOnly,
      type: 'villa',
      listing: 'RENT',
      bathrooms: { gte: 2 },
    });
  });
});

describe('buildPropertyOrderBy', () => {
  it.each([
    ['price_asc', [{ price: 'asc' }, { id: 'asc' }]],
    ['price_desc', [{ price: 'desc' }, { id: 'asc' }]],
    ['area_desc', [{ areaM2: 'desc' }, { id: 'asc' }]],
    ['newest', [{ createdAt: 'desc' }, { id: 'desc' }]],
  ] as const)('orders by %s with a stable tiebreaker', (sort, expected) => {
    expect(buildPropertyOrderBy(sort)).toEqual(expected);
  });
});
