import { z } from 'zod';
import { checkRanges, propertyFilterShape } from './property-filters.schema.js';

export const MAX_SEARCH_PAGE_SIZE = 50;
export const DEFAULT_SEARCH_PAGE_SIZE = 12;

export const propertySortSchema = z.enum([
  'price_asc',
  'price_desc',
  'newest',
  'area_desc',
]);

export type PropertySort = z.infer<typeof propertySortSchema>;

export const propertyPagingShape = {
  sort: propertySortSchema.default('newest'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_SEARCH_PAGE_SIZE)
    .default(DEFAULT_SEARCH_PAGE_SIZE),
} as const;

export const propertySearchQuerySchema = z
  .strictObject({ ...propertyFilterShape, ...propertyPagingShape })
  .superRefine(checkRanges);

export type PropertySearchQuery = z.infer<typeof propertySearchQuerySchema>;

export interface SearchOptions {
  sort?: PropertySort;
  page?: number;
  pageSize?: number;
}
