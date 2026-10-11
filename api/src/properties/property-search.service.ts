import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { parseFrontmatter } from '../common/frontmatter.js';
import type { Page } from '../common/pagination.js';
import type { Prisma } from '../generated/prisma/client.js';
import { Listing } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { mergeFacetValues } from './facet-values.js';
import { markdownExcerpt } from './markdown-excerpt.js';
import type {
  FacetValue,
  PriceRange,
  PropertyCard,
  PropertyDetail,
  PropertyFacets,
} from './property.dto.js';
import type { FacetsQuery } from './property-facets.schema.js';
import type { PropertyFilters } from './property-filters.schema.js';
import {
  DEFAULT_SEARCH_PAGE_SIZE,
  MAX_SEARCH_PAGE_SIZE,
  type SearchOptions,
} from './property-search.schema.js';
import { buildPropertyOrderBy, buildPropertyWhere } from './property-where.js';

const cardSelect = {
  id: true,
  slug: true,
  title: true,
  type: true,
  listing: true,
  price: true,
  currency: true,
  bedrooms: true,
  bathrooms: true,
  areaM2: true,
  city: true,
  district: true,
  compound: true,
  finishing: true,
  deliveryDate: true,
  paymentPlan: true,
} satisfies Prisma.PropertySelect;

type CardRow = Prisma.PropertyGetPayload<{ select: typeof cardSelect }>;

function toCard(row: CardRow, excerpt: string): PropertyCard {
  return { ...row, price: row.price.toNumber(), excerpt };
}

@Injectable()
export class PropertySearchService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async search(
    filters: PropertyFilters,
    {
      sort = 'newest',
      page = 1,
      pageSize = DEFAULT_SEARCH_PAGE_SIZE,
    }: SearchOptions = {},
  ): Promise<Page<PropertyCard>> {
    const size = Math.min(Math.max(1, pageSize), MAX_SEARCH_PAGE_SIZE);
    const current = Math.max(1, page);
    const where = buildPropertyWhere(filters);

    const [rows, total] = await Promise.all([
      this.prisma.property.findMany({
        where,
        orderBy: buildPropertyOrderBy(sort),
        skip: (current - 1) * size,
        take: size,
        select: {
          ...cardSelect,
          chunks: { where: { index: 0 }, take: 1, select: { content: true } },
        },
      }),
      this.prisma.property.count({ where }),
    ]);

    return {
      items: rows.map(({ chunks, ...row }) =>
        toCard(row, markdownExcerpt(chunks[0]?.content ?? '')),
      ),
      total,
      page: current,
      pageSize: size,
    };
  }

  async findBySlug(slug: string): Promise<PropertyDetail> {
    const row = await this.prisma.property.findFirst({
      where: { ...buildPropertyWhere({}), slug },
      select: { ...cardSelect, document: { select: { rawMarkdown: true } } },
    });
    if (!row) {
      throw new NotFoundException(`Property "${slug}" not found.`);
    }
    const { document, ...card } = row;
    const body = parseFrontmatter(document.rawMarkdown).content.trim();
    return { ...toCard(card, markdownExcerpt(body)), body };
  }

  /**
   * Facet values for the filter form. `city` only narrows the values that
   * depend on it (compounds); the list of cities itself stays global so the
   * visitor can always switch city.
   */
  async facets({ city }: FacetsQuery = {}): Promise<PropertyFacets> {
    const where = buildPropertyWhere({});
    const inCity = buildPropertyWhere({ city });
    const [cities, compounds, types, listings, sale, rent] = await Promise.all([
      this.prisma.property.groupBy({
        by: ['city'],
        where,
        _count: { _all: true },
      }),
      this.prisma.property.groupBy({
        by: ['compound'],
        where: { ...inCity, compound: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.property.groupBy({
        by: ['type'],
        where,
        _count: { _all: true },
      }),
      this.prisma.property.groupBy({
        by: ['listing'],
        where,
        _count: { _all: true },
      }),
      this.priceRange(Listing.SALE),
      this.priceRange(Listing.RENT),
    ]);

    const byCountThenName = (a: FacetValue, b: FacetValue) =>
      b.count - a.count || a.value.localeCompare(b.value);

    return {
      cities: mergeFacetValues(
        cities.map((row) => ({ value: row.city, count: row._count._all })),
      ).sort(byCountThenName),
      compounds: mergeFacetValues(
        compounds.flatMap((row) =>
          row.compound ? [{ value: row.compound, count: row._count._all }] : [],
        ),
      ).sort((a, b) => a.value.localeCompare(b.value)),
      types: types
        .map((row) => ({ value: row.type, count: row._count._all }))
        .sort((a, b) => a.value.localeCompare(b.value)),
      listings: listings
        .map((row) => ({ value: row.listing, count: row._count._all }))
        .sort((a, b) => a.value.localeCompare(b.value)),
      price: { SALE: sale, RENT: rent },
    };
  }

  private async priceRange(listing: Listing): Promise<PriceRange | null> {
    const { _min, _max } = await this.prisma.property.aggregate({
      where: { ...buildPropertyWhere({}), listing },
      _min: { price: true },
      _max: { price: true },
    });
    if (!_min.price || !_max.price) return null;
    return { min: _min.price.toNumber(), max: _max.price.toNumber() };
  }
}
