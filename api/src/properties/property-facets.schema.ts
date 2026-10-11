import { z } from 'zod';
import { propertyFilterShape } from './property-filters.schema.js';

/** `GET /properties/facets` query: narrow the dependent facets to one city. */
export const facetsQuerySchema = z.strictObject({
  city: propertyFilterShape.city,
});

export type FacetsQuery = z.infer<typeof facetsQuerySchema>;
