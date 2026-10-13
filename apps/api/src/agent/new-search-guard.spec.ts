import { describe, expect, it } from 'vitest';
import { dropCarriedOver } from './new-search-guard.js';

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
