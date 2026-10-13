import { describe, expect, it } from 'vitest';
import { dropCarriedOver, restatesFreshRequest } from './new-search-guard.js';

const previousFilters = {
  city: 'Sheikh Zayed',
  compound: 'Laurel Hills',
  type: 'villa',
  listing: 'RENT',
  priceMax: 50_000,
  bedroomsMin: 4,
  areaMin: 250,
} as const;

function guard(filters: Record<string, unknown>, latestMessage: string) {
  return dropCarriedOver({
    previousFilters: { ...previousFilters },
    previousSemanticQuery: '',
    filters: filters as never,
    semanticQuery: '',
    latestMessage,
  });
}

describe('dropCarriedOver', () => {
  it('removes every leaked value the message does not mention', () => {
    const result = guard(
      {
        ...previousFilters,
        type: 'apartment',
        listing: 'SALE',
        bedroomsMin: 3,
      },
      '3 bedroom apartment for sale',
    );
    expect(result.filters).toEqual({
      type: 'apartment',
      listing: 'SALE',
      bedroomsMin: 3,
    });
    expect(result.dropped).toEqual(['city', 'compound', 'priceMax', 'areaMin']);
  });

  it.each([
    ['in Zayed', { city: 'Sheikh Zayed' }],
    ['في الشيخ زايد', { city: 'Sheikh Zayed' }],
    ['at Laurel', { compound: 'Laurel Hills' }],
    ['SHEIKH ZAYED', { city: 'Sheikh Zayed' }],
  ])('keeps a location restated as %j', (message, kept) => {
    expect(guard({ ...previousFilters }, message).filters).toMatchObject(kept);
  });

  it.each([
    ['under 50,000 EGP', 50_000],
    ['up to 50k', 50_000],
    ['حد اقصى ٥٠ ألف', 50_000],
    ['٥٠٬٠٠٠ جنيه', 50_000],
  ])('keeps a budget restated as %j', (message, priceMax) => {
    expect(guard({ priceMax }, message).filters).toEqual({ priceMax });
  });

  it('reads million suffixes and spelled-out counts', () => {
    const before = {
      previousFilters: { priceMax: 12_000_000, bedroomsMin: 3 },
      previousSemanticQuery: '',
      semanticQuery: '',
    };
    const kept = dropCarriedOver({
      ...before,
      filters: { priceMax: 12_000_000, bedroomsMin: 3 },
      latestMessage: 'three bedroom flat, 12 million',
    });
    expect(kept.filters).toEqual({ priceMax: 12_000_000, bedroomsMin: 3 });
    const dropped = dropCarriedOver({
      ...before,
      filters: { priceMax: 12_000_000, bedroomsMin: 3 },
      latestMessage: 'a flat with a big garden',
    });
    expect(dropped.filters).toEqual({});
  });

  it('keeps values that differ from the previous search', () => {
    const result = guard({ city: 'Maadi', priceMax: 9_000_000 }, 'something');
    expect(result.filters).toEqual({ city: 'Maadi', priceMax: 9_000_000 });
    expect(result.dropped).toEqual([]);
  });

  it('drops a leaked type and listing the message does not name', () => {
    const result = guard({ type: 'villa', listing: 'RENT' }, 'in Maadi');
    expect(result.filters).toEqual({});
    expect(
      guard({ type: 'villa', listing: 'RENT' }, 'فيلا للإيجار').filters,
    ).toEqual({
      type: 'villa',
      listing: 'RENT',
    });
  });

  it('drops the qualitative preferences that leaked, keeps restated ones', () => {
    const base = {
      previousFilters: {},
      previousSemanticQuery: 'quiet street with a garden',
      filters: {},
      semanticQuery: 'quiet street with a garden',
    };
    expect(
      dropCarriedOver({ ...base, latestMessage: 'apartment in Maadi' })
        .semanticQuery,
    ).toBe('');
    expect(
      dropCarriedOver({ ...base, latestMessage: 'a quiet place with a garden' })
        .semanticQuery,
    ).toBe('quiet street with a garden');
  });
});

describe('restatesFreshRequest', () => {
  const previous = { city: 'Sheikh Zayed', listing: 'SALE' } as const;
  const apartmentSale = {
    ...previous,
    type: 'apartment',
    listing: 'SALE',
    bedroomsMin: 3,
  } as const;

  function check(
    latestMessage: string,
    filters: Record<string, unknown> = apartmentSale,
    previousFilters: Record<string, unknown> = previous,
  ) {
    return restatesFreshRequest({
      previousFilters: previousFilters as never,
      filters: filters as never,
      latestMessage,
    });
  }

  it('is true for a self-contained request that restates the deal and a type', () => {
    expect(check('3 bedroom apartment for sale under 12 million EGP.')).toBe(
      true,
    );
    expect(
      check('شقة 3 غرف للبيع', apartmentSale, { city: 'Sheikh Zayed' }),
    ).toBe(true);
    expect(
      check('apartment for rent', { type: 'apartment', listing: 'RENT' }),
    ).toBe(true);
  });

  it('is false for a narrowing follow-up', () => {
    expect(check('only apartments')).toBe(false);
    expect(check('apartments with 3 bedrooms please')).toBe(false);
    expect(check('cheaper', { ...previous, priceMax: 5_000_000 })).toBe(false);
    expect(
      check('in New Cairo only', { listing: 'SALE', city: 'New Cairo' }),
    ).toBe(false);
  });

  it('is false when the message names the earlier place or the earlier search had a type', () => {
    expect(check('apartment for sale in Zayed')).toBe(false);
    expect(
      check('3 bedroom apartment for sale', apartmentSale, {
        ...previous,
        type: 'apartment',
      }),
    ).toBe(false);
  });

  it('is false when the extraction lacks a type or a listing', () => {
    expect(check('apartment for sale', { listing: 'SALE' })).toBe(false);
    expect(check('apartment for sale', { type: 'apartment' })).toBe(false);
  });
});
