import { DocumentStatus } from '../generated/prisma/enums.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { PropertyFilters } from './property-filters.schema.js';
import type { PropertySort } from './property-search.schema.js';

function range(
  min: number | undefined,
  max: number | undefined,
): { gte?: number; lte?: number } | undefined {
  if (min === undefined && max === undefined) return undefined;
  return {
    ...(min !== undefined && { gte: min }),
    ...(max !== undefined && { lte: max }),
  };
}

export function buildPropertyWhere(
  filters: PropertyFilters,
): Prisma.PropertyWhereInput {
  const price = range(filters.priceMin, filters.priceMax);
  const area = range(filters.areaMin, filters.areaMax);

  return {
    document: { status: DocumentStatus.INDEXED },
    ...(filters.city && {
      city: { equals: filters.city, mode: 'insensitive' },
    }),
    ...(filters.district && {
      district: { equals: filters.district, mode: 'insensitive' },
    }),
    ...(filters.compound && {
      compound: { contains: filters.compound, mode: 'insensitive' },
    }),
    ...(filters.type && { type: filters.type }),
    ...(filters.listing && { listing: filters.listing }),
    ...(price && { price }),
    ...(area && { areaM2: area }),
    ...(filters.bedroomsMin !== undefined && {
      bedrooms: { gte: filters.bedroomsMin },
    }),
    ...(filters.bathroomsMin !== undefined && {
      bathrooms: { gte: filters.bathroomsMin },
    }),
  };
}

export function buildPropertyOrderBy(
  sort: PropertySort,
): Prisma.PropertyOrderByWithRelationInput[] {
  switch (sort) {
    case 'price_asc':
      return [{ price: 'asc' }, { id: 'asc' }];
    case 'price_desc':
      return [{ price: 'desc' }, { id: 'asc' }];
    case 'area_desc':
      return [{ areaM2: 'desc' }, { id: 'asc' }];
    case 'newest':
      return [{ createdAt: 'desc' }, { id: 'desc' }];
  }
}
