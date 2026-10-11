import { z } from "zod";

export const PROPERTY_TYPES = [
  "apartment",
  "villa",
  "townhouse",
  "duplex",
  "chalet",
  "studio",
  "office",
] as const;

export const propertyTypeSchema = z.enum(PROPERTY_TYPES);
export const listingSchema = z.enum(["SALE", "RENT"]);

export type PropertyType = z.infer<typeof propertyTypeSchema>;
export type Listing = z.infer<typeof listingSchema>;

export const propertyCardSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  type: propertyTypeSchema,
  listing: listingSchema,
  price: z.number(),
  currency: z.string(),
  bedrooms: z.number(),
  bathrooms: z.number(),
  areaM2: z.number(),
  city: z.string(),
  district: z.string().nullable(),
  compound: z.string().nullable(),
  finishing: z.string().nullable(),
  deliveryDate: z.coerce.date().nullable(),
  paymentPlan: z.string().nullable(),
  excerpt: z.string(),
});

export type PropertyCard = z.infer<typeof propertyCardSchema>;

export const propertyPageSchema = z.object({
  items: z.array(propertyCardSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

export type PropertyPage = z.infer<typeof propertyPageSchema>;

const facetValueSchema = z.object({ value: z.string(), count: z.number() });
const priceRangeSchema = z.object({ min: z.number(), max: z.number() });

export const propertyFacetsSchema = z.object({
  cities: z.array(facetValueSchema),
  compounds: z.array(facetValueSchema),
  types: z.array(z.object({ value: propertyTypeSchema, count: z.number() })),
  listings: z.array(z.object({ value: listingSchema, count: z.number() })),
  price: z.object({
    SALE: priceRangeSchema.nullable(),
    RENT: priceRangeSchema.nullable(),
  }),
});

export type PropertyFacets = z.infer<typeof propertyFacetsSchema>;
