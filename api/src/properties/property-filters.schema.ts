import { z } from 'zod';
import { Listing, PropertyType } from '../generated/prisma/enums.js';

const text = (description: string) =>
  z.string().trim().min(1).max(100).describe(description).optional();

const amount = (description: string) =>
  z.coerce.number().nonnegative().describe(description).optional();

const count = (description: string) =>
  z.coerce.number().int().nonnegative().describe(description).optional();

export const propertyFilterShape = {
  city: text(
    'City or area name, e.g. "New Cairo". Matched case-insensitively.',
  ),
  compound: text(
    'Compound (gated community) name or part of it, e.g. "Laurel".',
  ),
  district: text('District or neighbourhood inside the city.'),
  type: z.enum(PropertyType).describe('Property type.').optional(),
  listing: z
    .enum(Listing)
    .describe('SALE for buying, RENT for renting.')
    .optional(),
  priceMin: amount(
    'Minimum price in EGP. For RENT listings the price is per month.',
  ),
  priceMax: amount(
    'Maximum price in EGP. For RENT listings the price is per month.',
  ),
  bedroomsMin: count('Minimum number of bedrooms.'),
  bathroomsMin: count('Minimum number of bathrooms.'),
  areaMin: amount('Minimum built area in square metres.'),
  areaMax: amount('Maximum built area in square metres.'),
} as const;

type RangeFields = {
  priceMin?: number | undefined;
  priceMax?: number | undefined;
  areaMin?: number | undefined;
  areaMax?: number | undefined;
};

export function checkRanges(filters: RangeFields, ctx: z.RefinementCtx): void {
  const pairs = [
    ['priceMin', 'priceMax', filters.priceMin, filters.priceMax],
    ['areaMin', 'areaMax', filters.areaMin, filters.areaMax],
  ] as const;
  for (const [minKey, maxKey, min, max] of pairs) {
    if (min !== undefined && max !== undefined && min > max) {
      ctx.addIssue({
        code: 'custom',
        path: [minKey],
        message: `${minKey} must not be greater than ${maxKey}`,
      });
    }
  }
}

export const propertyFiltersSchema = z
  .strictObject(propertyFilterShape)
  .superRefine(checkRanges);

export type PropertyFilters = z.infer<typeof propertyFiltersSchema>;
