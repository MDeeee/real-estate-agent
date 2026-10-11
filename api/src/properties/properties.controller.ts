import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import type { Page } from '../common/pagination.js';
import { DropBlankValuesPipe } from '../common/drop-blank-values.pipe.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type {
  PropertyCard,
  PropertyDetail,
  PropertyFacets,
} from './property.dto.js';
import {
  type PropertySearchQuery,
  propertySearchQuerySchema,
} from './property-search.schema.js';
import { PropertySearchService } from './property-search.service.js';

const slugSchema = z.string().min(1).max(120);

@Controller('properties')
export class PropertiesController {
  constructor(
    @Inject(PropertySearchService)
    private readonly search: PropertySearchService,
  ) {}

  @Get()
  list(
    @Query(
      new DropBlankValuesPipe(),
      new ZodValidationPipe(propertySearchQuerySchema),
    )
    query: PropertySearchQuery,
  ): Promise<Page<PropertyCard>> {
    const { sort, page, pageSize, ...filters } = query;
    return this.search.search(filters, { sort, page, pageSize });
  }

  @Get('facets')
  facets(): Promise<PropertyFacets> {
    return this.search.facets();
  }

  @Get(':slug')
  detail(
    @Param('slug', new ZodValidationPipe(slugSchema)) slug: string,
  ): Promise<PropertyDetail> {
    return this.search.findBySlug(slug);
  }
}
